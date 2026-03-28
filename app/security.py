import socket
import ipaddress
from urllib.parse import urlparse


def is_private_address(url: str) -> bool:
    """SSRF対策: 内部ネットワークを拒否"""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return True
        host = parsed.hostname
        if not host:
            return True
        # DNS解決してIPチェック
        addr_info = socket.getaddrinfo(host, None)
        for _, _, _, _, sockaddr in addr_info:
            ip = ipaddress.ip_address(sockaddr[0])
            if ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_link_local or ip.is_multicast:
                return True
        return False
    except Exception:
        return True
