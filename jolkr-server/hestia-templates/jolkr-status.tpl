#=========================================================================#
# Custom Jolkr status template (port 80)
#
# status.jolkr.app proxies to the API's /health page, which renders a styled
# "Jolkr — Service Status" document for browsers and JSON for everything else.
# The page itself was restyled to the landing palette in v0.12.1.
#
# Do NOT re-add a `location ^~ /.well-known/acme-challenge/` block here:
# the `^~` modifier disables regex matching for that prefix and shadows
# Hestia's token location. Hestia writes the token as an nginx `return
# 200`, never as a file on disk, so a docroot-based block can never
# satisfy the challenge. That is what let the upload certificate expire.
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
