"""
Valve KeyValues text (VMT materials, VMF maps): a tokenizer and a parser to
nested lists of (key, value) pairs. Keys repeat (a VMF has many "solid"
blocks), so blocks are lists, not dicts. Keys are lower-cased.

    blocks = parse(text)                  # [(key, value_or_list), ...]
    get(block, '$basetexture')            # first value for a key
    children(blocks, 'entity')            # every sub-block named 'entity'
"""


def tokens(s: str):
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c in ' \t\r\n﻿':
            i += 1
        elif c == '/' and s.startswith('//', i):
            j = s.find('\n', i)
            i = n if j < 0 else j
        elif c in '{}':
            yield c
            i += 1
        elif c == '"':
            j = s.find('"', i + 1)
            if j < 0:
                j = n
            yield s[i + 1:j]
            i = j + 1
        else:
            j = i
            while j < n and s[j] not in ' \t\r\n{}"':
                j += 1
            yield s[i:j]
            i = j


def parse(s: str) -> list:
    it = tokens(s)
    stack = [[]]
    key = None
    for t in it:
        if t == '{':
            blk = []
            stack[-1].append(((key or '').lower(), blk))
            stack.append(blk)
            key = None
        elif t == '}':
            if len(stack) > 1:
                stack.pop()
            key = None
        elif key is None:
            key = t
        else:
            stack[-1].append((key.lower(), t))
            key = None
    return stack[0]


def get(block: list, key: str, default=None):
    key = key.lower()
    for k, v in block:
        if k == key:
            return v
    return default


def children(block: list, key: str) -> list:
    key = key.lower()
    return [v for k, v in block if k == key and isinstance(v, list)]


def first_block(blocks: list) -> tuple:
    """A VMT is one named block: (shader name, params)."""
    for k, v in blocks:
        if isinstance(v, list):
            return k, v
    return '', []
