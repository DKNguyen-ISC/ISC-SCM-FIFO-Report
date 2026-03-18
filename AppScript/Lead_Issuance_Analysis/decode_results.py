"""Parse bq_results.txt and extract structured data for analysis."""
with open('bq_results.txt', 'r', encoding='utf-8') as f:
    content = f.read()

# Print full content in one shot (avoid PS buffer issues)
import base64
encoded = base64.b64encode(content.encode('utf-8')).decode('ascii')
with open('bq_encoded.txt', 'w') as f:
    f.write(encoded)
print(f"Encoded to bq_encoded.txt — length: {len(encoded)} chars")
print(f"Original content preview (first 3000 chars):")
print(content[:3000])
