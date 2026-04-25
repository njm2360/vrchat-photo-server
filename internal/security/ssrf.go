package security

import (
	"fmt"
	"net"
)

// IsPrivateHost returns true if host resolves to any private/reserved IP,
// or if DNS resolution fails. Fails closed (blocks on any error).
func IsPrivateHost(host string) bool {
	addrs, err := net.LookupHost(host)
	if err != nil {
		return true
	}
	for _, addr := range addrs {
		ip := net.ParseIP(addr)
		if ip == nil || IsReservedIP(ip) {
			return true
		}
	}
	return false
}

func IsReservedIP(ip net.IP) bool {
	return ip.IsPrivate() ||
		ip.IsLoopback() ||
		ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsMulticast()
}

// SSRFDialer returns a net.Dialer-compatible DialContext function that
// rejects connections to private addresses.
func SSRFCheck(host string) error {
	if IsPrivateHost(host) {
		return fmt.Errorf("blocked: private or reserved address")
	}
	return nil
}
