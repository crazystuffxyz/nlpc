@echo off
rem register .nlp files with nlpc compile on this Windows machine
rem requires: nlpc on PATH (npm install -g nlpc, or run from this checkout)
assoc .nlp=NLPFile
ftype NLPFile=nlpc compile "%%1" --no-run
echo registered .nlp -> nlpc compile
