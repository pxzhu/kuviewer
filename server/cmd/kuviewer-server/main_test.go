package main

import "testing"

func TestIsLoopbackListenAddr(t *testing.T) {
	tests := []struct {
		addr string
		want bool
	}{
		{addr: "127.0.0.1:8080", want: true},
		{addr: "localhost:8080", want: true},
		{addr: "[::1]:8080", want: true},
		{addr: "0.0.0.0:8080", want: false},
		{addr: ":8080", want: false},
		{addr: "192.0.2.10:8080", want: false},
		{addr: "bad-addr", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.addr, func(t *testing.T) {
			if got := isLoopbackListenAddr(tt.addr); got != tt.want {
				t.Fatalf("isLoopbackListenAddr(%q) = %v, want %v", tt.addr, got, tt.want)
			}
		})
	}
}
