//go:build !windows

package stealer

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

func Run() Result {
	return Result{Errors: []string{"stealer not supported on this platform"}}
}
