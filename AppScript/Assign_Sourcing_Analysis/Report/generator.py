import os
import re

# Paths
base_dir = r"g:\My Drive\Tech Jobs\ISC\Presentation\Report 2\Task 1 Supply Chain Database\Diagrams\SC Database Diagrams\Diagrams\Diagrams Version 129-Assign_Sourcing_Analysis\AppScript\Assign_Sourcing_Analysis\Report"
v3_file = os.path.join(base_dir, "Report_V3", "index.html")
v4_dir = os.path.join(base_dir, "Report_V4")

os.makedirs(v4_dir, exist_ok=True)

with open(v3_file, 'r', encoding='utf-8') as f:
    html_content = f.read()

# Extract CSS
css_start = html_content.find('<style>')
css_end = html_content.find('</style>') + len('</style>')
css_content = html_content[css_start + 7:css_end - 8].strip()

with open(os.path.join(v4_dir, "Style.css"), 'w', encoding='utf-8') as f:
    f.write(css_content)

# Remove style from HTML and add link to Style.css
head_start = html_content.find('<head>')
head_end = html_content.find('</head>')
head_content = html_content[head_start:head_end]
head_content_new = re.sub(r'<style>.*?</style>', '<link rel="stylesheet" href="Style.css">', head_content, flags=re.DOTALL)

# Header changes (title, version)
head_content_new = head_content_new.replace("V2", "V4")

# Extract Script
script_start = html_content.find('<script>')
script_end = html_content.find('</script>') + len('</script>')
script_content = html_content[script_start:script_end]

# Redefine the sidebar navigation
new_nav = """
        <ul class="nav-links">
            <li><a href="index.html" id="nav_index"><span class="icon-wrap"><i class="fa-solid fa-bolt"></i></span>0. Tóm tắt điều hành</a></li>
            <li><a href="p1_tolerance.html" id="nav_p1"><span class="icon-wrap"><i class="fa-solid fa-scale-balanced"></i></span>1. P1: Tolerance</a></li>
            <li><a href="p2_vpo_fragmentation.html" id="nav_p2"><span class="icon-wrap"><i class="fa-solid fa-cubes-stacked"></i></span>2. P2: VPO Fragmentation</a></li>
            <li><a href="p3_warehouse.html" id="nav_p3"><span class="icon-wrap"><i class="fa-solid fa-warehouse"></i></span>3. P3: Issuance Laziness</a></li>
            <li><a href="validation.html" id="nav_valid"><span class="icon-wrap"><i class="fa-solid fa-laptop-code"></i></span>4. Kiểm chứng Logic</a></li>
            <li><a href="solutions.html" id="nav_sol"><span class="icon-wrap"><i class="fa-solid fa-lightbulb"></i></span>5. Đề xuất Thay đổi</a></li>
            <li><a href="conclusion.html" id="nav_conc"><span class="icon-wrap"><i class="fa-solid fa-book-open"></i></span>6. Hướng dẫn đọc & Kết luận</a></li>
        </ul>
"""

nav_start = html_content.find('<ul class="nav-links">')
nav_end = html_content.find('</ul>', nav_start) + 5
sidebar_content = html_content[html_content.find('<nav class="sidebar">'):html_content.find('</nav>') + 6]
sidebar_content_new = sidebar_content[:sidebar_content.find('<ul class="nav-links">')] + new_nav + sidebar_content[sidebar_content.find('</ul>')+5:]
sidebar_content_new = sidebar_content_new.replace("Version V2 – 2026-03", "Version V4 – 2026-03")

# Extract Header
header_content = html_content[html_content.find('<header class="top-header"'):html_content.find('</header>') + 9]
header_content = header_content.replace("V2 · 2026-03", "V4 · 2026-03")

# Extract footer
footer_content = html_content[html_content.find('<footer class="footer mt-12">'):html_content.find('</footer>') + 9]
footer_content = footer_content.replace("BRS V2", "BRS V4")

# Extract Sections
sections = []
pos = html_content.find('<section')
while pos != -1:
    end_pos = html_content.find('</section>', pos) + 10
    sections.append(html_content[pos:end_pos])
    pos = html_content.find('<section', end_pos)

# Modify Section 0 (Exec Summary) text about Tolerance
sec0 = sections[0]
sec0 = sec0.replace("Lead Plan dùng <strong>10% cố định</strong>", "Lead Plan dùng <strong>Buffer từ 5% đến 20%</strong> (có lúc ngoài mốc này, không theo chuẩn CS/HQ)")
sec0 = sec0.replace("Buffer 10% cố định, dễ giải thích, an toàn (P1 fix)", "Buffer linh hoạt (5–20%), điều chỉnh theo thực tế vận hành (P1 fix)")
sec0 = sec0.replace("Thêm menu chọn <em>Tolerance mode</em> (CS hay ISC 10%)", "Thêm menu chọn <em>Tolerance mode</em> (CS hay ISC Linh hoạt 5-20%)")

# Modify Section 1 (P1 Tolerance)
sec1 = sections[1]
sec1 = sec1.replace("áp dụng <strong>10% cố định</strong> cho đa số BOM theo quy ước nội bộ ISC.", "áp dụng <strong>Buffer linh hoạt từ 5% đến 20%</strong> cho đa số BOM (phá vỡ ràng buộc của CS/HQ) theo tình hình thực tế và quy ước nội bộ ISC.")
sec1 = sec1.replace('<span class="tag tag-solid">10% Cố định (đa số BOM)</span>', '<span class="tag tag-solid">Linh hoạt 5% - 20% (hoặc hơn)</span>')
sec1 = sec1.replace("Một ít BOM đặc biệt dùng 20%", "Điều chỉnh tùy ý theo planner (không cố định)")
sec1 = sec1.replace("× <span class=\"code-highlight\">(1 + 10%)</span>", "× <span class=\"code-highlight\">(1 + ISC Buffer %)</span>")
sec1 = sec1.replace("Lead Plan (ISC Tolerance = 10%)", "Lead Plan (ISC Buffer linh hoạt, vd: 10%)")
sec1 = sec1.replace("Tolerance 10% ISC mang tính <strong>vận hành</strong> (đơn giản, dễ giải thích, an toàn).", "Mức Buffer 5-20% của ISC mang tính <strong>vận hành thực tiễn</strong>, linh hoạt để xử lý shortage thực tế.")
sec1 = sec1.replace("chế độ chọn tolerance (CS hay ISC)", "chế độ chọn tolerance (CS cố định hay ISC linh hoạt)")

# Modify Section 5 (Solutions)
sec5 = sections[4]
sec5 = sec5.replace("Chế độ 2: ISC 10% Fixed", "Chế độ 2: ISC Buffer Linh Hoạt (5-20%)")
sec5 = sec5.replace("<code>ISC_10%</code>", "<code>ISC_FLEX</code>")
sec5 = sec5.replace("chọn \"ISC 10%\" → số shortage gần giống Excel", "chọn \"ISC Flex\" → số shortage khớp với tư duy của planner trên Excel")


def build_page(file_name, active_id, page_sections, title):
    head = head_content_new.replace("Báo cáo Phân tích Assign Sourcing", title)
    # Highlight the active nav menu
    sidebar = sidebar_content_new.replace(f'id="{active_id}"', f'id="{active_id}" class="active"')
    
    sections_html = "\\n\\n".join(page_sections)
    
    # Simple script for scrolling animation wrapper (modified slightly since no scroll tracking of sections needed)
    new_script = """
    <script>
        document.querySelectorAll('.animate-on-scroll').forEach(el => {
            el.classList.add('is-visible'); // Trigger directly since chunked pages 
        });
    </script>
    """
    
    page = f'''<!DOCTYPE html>
<html lang="vi">
{head}
</head>
<body>
    {sidebar}
    <main class="content">
        {header_content}
        
        {sections_html}
        
        {footer_content}
    </main>
    {new_script}
</body>
</html>
'''
    with open(os.path.join(v4_dir, file_name), "w", encoding='utf-8') as f:
        f.write(page)

# Build the pages
build_page("index.html", "nav_index", [sec0], "Tóm tắt | ISC Report V4")
build_page("p1_tolerance.html", "nav_p1", [sec1], "P1: Tolerance | ISC Report V4")
build_page("p2_vpo_fragmentation.html", "nav_p2", [sections[2]], "P2: VPO | ISC Report V4")
build_page("p3_warehouse.html", "nav_p3", [sections[3]], "P3: Kho | ISC Report V4")
build_page("validation.html", "nav_valid", [sections[4]], "Kiểm chứng | ISC Report V4") # sec4 = sections[4] => wait, logic validation is actually the first section in sections left after section 3. Wait, let's map carefully.
# In original index.html:
# section 0: exec (idx 0)
# section 1: p1 (idx 1)
# section 2: p2 (idx 2)
# section 3: p3 (idx 3)
# section 4: validation (idx 4)
# section 5: solutions (idx 5)
# section 6: guide (idx 6) -> conclusion is also in here?

print("Done")
