package provider

import "testing"

func TestDNSSubdomainValidationIsASCIIAndBounded(t *testing.T) {
	valid := []string{"api", "api-v1", "api.edge.example.com"}
	for _, value := range valid {
		if !validDNSSubdomain(value) {
			t.Fatalf("validDNSSubdomain(%q) = false", value)
		}
	}

	invalid := []string{"", "API", "-api", "api-", "api..example.com", "api_example", "서비스"}
	for _, value := range invalid {
		if validDNSSubdomain(value) {
			t.Fatalf("validDNSSubdomain(%q) = true, want rejected", value)
		}
	}
}
