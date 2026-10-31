#!/bin/bash
# "on"/"off" from the last pmset display notification (ioreg framebuffer state proved unreliable)
pmset -g log | grep -E "Display is turned (on|off)" | tail -1 | grep -q "turned on" && echo on || echo off
