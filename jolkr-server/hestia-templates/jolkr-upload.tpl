#=========================================================================#
# Custom Jolkr upload template (port 80)
#
# Upload-only subdomain. Everything redirects to https except the ACME
# HTTP-01 challenge, which Hestia serves from nginx.conf_letsencrypt via
# the include at the bottom.
#
# Do NOT re-add a `location ^~ /.well-known/acme-challenge/` block here:
# the `^~` modifier disables regex matching for that prefix and shadows
# Hestia's token location. Hestia writes the token as an nginx `return
# 200`, never as a file on disk, so a docroot-based block can never
# satisfy the challenge. That is what let the certificate expire.
#=========================================================================#
server {
    listen      %ip%:%proxy_port%;
    server_name %domain_idn% %alias_idn%;
    access_log  /var/log/%web_system%/domains/%domain%.log combined;
    access_log  /var/log/%web_system%/domains/%domain%.bytes bytes;

    # Everything → https
    location / { return 301 https://$host$request_uri; }

    # Hestia LE http-01 token. Regex location, so it wins over the prefix
    # location above and the challenge is answered on plain http.
    include /home/%user%/conf/web/%domain%/nginx.conf_*;
}
