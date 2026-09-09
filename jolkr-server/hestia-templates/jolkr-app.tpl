#=========================================================================#
# Default Web Domain Template                                             #
# DO NOT MODIFY THIS FILE! CHANGES WILL BE LOST WHEN REBUILDING DOMAINS   #
# https://hestiacp.com/docs/server-administration/web-templates.html      #
#=========================================================================#

server {
	listen      %ip%:%proxy_port%;
	server_name %domain_idn% %alias_idn%;
	error_log   /var/log/%web_system%/domains/%domain%.error.log error;

	include %home%/%user%/conf/web/%domain%/nginx.forcessl.conf*;

	location ~ /\.(?!well-known\/|file) {
		deny all;
		return 404;
	}

	location / {
		proxy_ssl_server_name on;
		proxy_ssl_name $host;
		proxy_pass https://%ip%:%web_ssl_port%;

		location ~* ^.+\.(%proxy_extensions%)$ {
			try_files  $uri @fallback;

			root       %home%/%user%/web/%domain%/public_html;
			access_log /var/log/%web_system%/domains/%domain%.log combined;
			access_log /var/log/%web_system%/domains/%domain%.bytes bytes;

			expires    max;
		}
	}

	location /app/ {
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_read_timeout 90;
		# WebSocket support
		proxy_http_version 1.1;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
		proxy_pass https://192.168.178.22/app/;
	}

	location /api/ {
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_read_timeout 90;
		# WebSocket support
		proxy_http_version 1.1;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
		proxy_pass https://192.168.178.22/api/;
	}
	
	location /health {
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_read_timeout 90;
		proxy_pass https://192.168.178.22/health;
	}

	location /ws {
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_read_timeout 86400;
		proxy_send_timeout 86400;
		# WebSocket support
		proxy_http_version 1.1;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
		proxy_pass https://192.168.178.22/ws;
	}

	location /media/ {
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_read_timeout 90;
		# WebSocket support
		proxy_http_version 1.1;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
		proxy_pass https://192.168.178.22/media/;
	}

	location /s3/ {
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_read_timeout 90;
		# WebSocket support
		proxy_http_version 1.1;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
		proxy_pass https://192.168.178.22/s3/;
	}

	location @fallback {
		proxy_http_version 1.1;
		proxy_pass http://%ip%:%web_port%;
	}

	# Jolkr error pages — per-vhost override of the http-level map in nginx.conf.
	# proxy_intercept_errors stays off: upstream errors keep their own body.
	error_page 400 /error/400.html;
	error_page 401 /error/401.html;
	error_page 403 /error/403.html;
	error_page 404 /error/404.html;
	error_page 410 /error/410.html;
	error_page 413 /error/413.html;
	error_page 429 /error/429.html;
	error_page 500 /error/500.html;
	error_page 502 /error/502.html;
	error_page 503 /error/503.html;
	error_page 504 /error/504.html;
	error_page 501 505 /error/50x.html;

	location /error/ {
		alias %home%/%user%/web/%domain%/document_errors/;
	}

	include %home%/%user%/conf/web/%domain%/nginx.conf_*;
}
