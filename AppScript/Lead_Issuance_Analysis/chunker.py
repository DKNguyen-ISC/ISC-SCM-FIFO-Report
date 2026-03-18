"""Write bq_results.txt content in small chunks to numbered text files."""
with open('bq_results.txt', 'r', encoding='utf-8') as f:
    lines = f.readlines()

chunk_size = 60
for i in range(0, len(lines), chunk_size):
    chunk = lines[i:i+chunk_size]
    fname = f'chunk_{i:03d}.txt'
    with open(fname, 'w', encoding='utf-8') as f:
        f.writelines(chunk)
    print(f"Written {fname}")

print(f"Total lines: {len(lines)}")
