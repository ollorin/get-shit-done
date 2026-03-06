#!/usr/bin/env python3
"""
Apply LLMLingua-2 compression to a document and print the result.
Usage: python3 compress.py <doc_path> <rate>
  rate: target token retention rate (0.3 = keep 30%, 0.5 = keep 50%)
"""
import sys
import time
import json

def compress(doc_path, rate=0.4):
    with open(doc_path, 'r') as f:
        content = f.read()

    original_chars = len(content)
    original_tokens = -(-len(content) // 4)  # ceil div

    from llmlingua import PromptCompressor
    llm_lingua = PromptCompressor(
        model_name='microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank',
        use_llmlingua2=True,
        device_map='cpu'
    )

    # Split into chunks of ~2000 chars to avoid memory issues on large docs
    chunk_size = 3000
    chunks = [content[i:i+chunk_size] for i in range(0, len(content), chunk_size)]

    compressed_parts = []
    for chunk in chunks:
        if len(chunk.strip()) < 50:
            compressed_parts.append(chunk)
            continue
        try:
            result = llm_lingua.compress_prompt(
                [chunk],
                rate=rate,
                force_tokens=['\n', '?', '#', '`'],
                drop_consecutive=True
            )
            compressed_parts.append(result['compressed_prompt'])
        except Exception as e:
            # On error, keep original chunk
            compressed_parts.append(chunk)

    compressed = '\n'.join(compressed_parts)
    compressed_chars = len(compressed)
    compressed_tokens = -(-len(compressed) // 4)

    meta = {
        'original_chars': original_chars,
        'compressed_chars': compressed_chars,
        'original_tokens_est': original_tokens,
        'compressed_tokens_est': compressed_tokens,
        'reduction_pct': round((1 - compressed_chars / original_chars) * 100, 1),
        'rate_requested': rate,
    }

    # Output: first line is JSON meta, rest is compressed text
    print(json.dumps(meta))
    print(compressed)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: compress.py <doc_path> [rate=0.4]", file=sys.stderr)
        sys.exit(1)
    doc_path = sys.argv[1]
    rate = float(sys.argv[2]) if len(sys.argv) > 2 else 0.4
    compress(doc_path, rate)
