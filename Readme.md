# RepliDA

This project allows authenticated users create VMs from template and submit to admins without manually managing permissions on Proxmox VE.

## Requirements

- nodejs
- npm (prefer pnpm)
- Proxmox VE with a Admin account

## Installation

```shell
git clone https://github.com/lekoOwO/RepliDA/
cd RepliDA
npm i

echo "Save the config as data/config.js"
vim data/config.example.js
```

## Login Modules

- [RepliDA-OpenID](https://github.com/lekoOwO/RepliDA-OpenID)
