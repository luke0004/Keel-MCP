#!/bin/bash
cd "$(dirname "$0")/.."
exec node --import tsx src/server.ts
