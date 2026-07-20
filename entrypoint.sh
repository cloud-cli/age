if [ ! -z "$PKG_INSTALL"]; then
  apk add --allow-untrusted $PKG_INSTALL
fi

source /home/node/entrypoint.sh