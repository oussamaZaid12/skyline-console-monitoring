#!/bin/bash

# Demander le message de commit
read -p "Message de commit: " commit_msg

# Vérifier si vide
if [ -z "$commit_msg" ]; then
  echo "❌ Commit annulé (message vide)"
  exit 1
fi

# Aller dans le dossier
cd ~/projects/skyline-console-monitoring || exit

# Build + commit + push
NODE_OPTIONS="--openssl-legacy-provider --max-old-space-size=8192" \
NODE_ENV=production \
./node_modules/.bin/webpack --config config/webpack.prod.js && \
git add . && \
git commit -m "$commit_msg" --no-verify && \
git push origin develop

echo "✅ Deploy terminé"
