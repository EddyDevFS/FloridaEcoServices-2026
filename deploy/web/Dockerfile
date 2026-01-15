FROM caddy:2-alpine

# We use Caddy image as a lightweight static file server target for the proxy.
# The actual HTTPS/ACME is handled by the "caddy" service; this container only holds assets.

WORKDIR /srv

COPY *.html /srv/
COPY *.css /srv/
COPY *.js /srv/
COPY shared /srv/shared
COPY media /srv/media
COPY tools /srv/tools
COPY PUBLIC /srv/PUBLIC
COPY CONFIGURATION /srv/CONFIGURATION

# Defensive: remove anything that could expose backend code if present (no-op if absent).
RUN rm -rf /srv/backend /srv/node_modules /srv/.git || true

