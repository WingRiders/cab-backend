#!/bin/sh

if [ -z "$PORT" ]; then
  PORT=3000
fi

# check if the app started correctly
[ "$(wget -qO- http://localhost:$PORT/healthstatus)" = '{"status":"ok"}' ]
