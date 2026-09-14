#!/usr/bin/env python3
import sys

def sync():
    with open('/root/harkat-photobooth/dev2.html', 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace dev 2 markers with production titles
    content = content.replace(
        '<title>UKM EXPO UHN — HARKAT Photobooth (Dev 2)</title>',
        '<title>UKM EXPO UHN — HARKAT Photobooth</title>'
    )
    content = content.replace(
        '<small>PHOTO BOOTH (DEV 2) 🧪</small>',
        '<small>PHOTO BOOTH ✦</small>'
    )

    with open('/root/harkat-photobooth/photobooth.html', 'w', encoding='utf-8') as f:
        f.write(content)

    print('Synced dev2.html -> photobooth.html successfully.')

if __name__ == '__main__':
    sync()
