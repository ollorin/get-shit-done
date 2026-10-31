#!/bin/bash
# blocks until display has been off for 20 consecutive seconds
D=$(dirname "$0"); n=0
while [ $n -lt 20 ]; do if [ "$($D/display-state.sh)" = off ]; then n=$((n+1)); else n=0; fi; sleep 1; done
