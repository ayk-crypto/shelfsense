#!/bin/bash
set -e

npm install --workspaces --include-workspace-root

npm run db:deploy
