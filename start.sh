#!/bin/bash

pm2 start ecosystem.config.js
pm2 startup
pm2 save
pm2 list