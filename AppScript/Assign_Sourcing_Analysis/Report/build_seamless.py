import os
import re

v4_dir = r"g:\My Drive\Tech Jobs\ISC\Presentation\Report 2\Task 1 Supply Chain Database\Diagrams\SC Database Diagrams\Diagrams\Diagrams Version 129-Assign_Sourcing_Analysis\AppScript\Assign_Sourcing_Analysis\Report\Report_V4"

# Ensure we read the newly fixed p1_tolerance.html 
files_to_merge = [
    "index.html", # Has exec summary
    "p1_tolerance.html",
    "p2_vpo_fragmentation.html",
    "p3_warehouse.html",
    "validation.html",
    "solutions.html",
    "conclusion.html"
]

all_sections = []

for idx, file in enumerate(files_to_merge):
    with open(os.path.join(v4_dir, file), 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Extract the <section> tags
    pos = content.find('<section')
    while pos != -1:
        end_pos = content.find('</section>', pos) + 10
        all_sections.append(content[pos:end_pos])
        pos = content.find('<section', end_pos)

# Also need the wrapper <div class="grid-2 gap-8"> for the last two sections (from conclusion.html)
# Actually, conclusion.html has the grid-2 wrapper around it. Let's safely extract it.
with open(os.path.join(v4_dir, "conclusion.html"), 'r', encoding='utf-8') as f:
    conc_content = f.read()
    grid_start = conc_content.find('<div class="grid-2 gap-8">')
    grid_end = conc_content.find('</div>', conc_content.rfind('</section>')) + 6
    if grid_start != -1:
        # replace the last two sections with this wrapper block which includes them
        all_sections = all_sections[:-2] + [conc_content[grid_start:grid_end]]

sections_html = "\\n\\n".join(all_sections)

# Base template from index.html head/sidebar/footer
with open(os.path.join(v4_dir, "index.html"), 'r', encoding='utf-8') as f:
    base_content = f.read()

head = base_content[:base_content.find('<body>')]

header_content = base_content[base_content.find('<header class="top-header"'):base_content.find('</header>') + 9]
footer_content = base_content[base_content.find('<footer class="footer mt-12">'):base_content.find('</footer>') + 9]

new_nav = """
        <ul class="nav-links">
            <li><a href="#executive-summary" class="active"><span class="icon-wrap"><i class="fa-solid fa-bolt"></i></span>0. Tóm tắt điều hành</a></li>
            <li><a href="#p1-tolerance"><span class="icon-wrap"><i class="fa-solid fa-scale-balanced"></i></span>1. P1: Tolerance</a></li>
            <li><a href="#p2-vpo-fragmentation"><span class="icon-wrap"><i class="fa-solid fa-cubes-stacked"></i></span>2. P2: VPO Fragmentation</a></li>
            <li><a href="#p3-warehouse"><span class="icon-wrap"><i class="fa-solid fa-warehouse"></i></span>3. P3: Issuance Laziness</a></li>
            <li><a href="#logic-validation"><span class="icon-wrap"><i class="fa-solid fa-laptop-code"></i></span>4. Kiểm chứng Logic</a></li>
            <li><a href="#solutions"><span class="icon-wrap"><i class="fa-solid fa-lightbulb"></i></span>5. Đề xuất Thay đổi</a></li>
            <li><a href="#guide"><span class="icon-wrap"><i class="fa-solid fa-book-open"></i></span>6. Hướng dẫn đọc</a></li>
            <li><a href="#conclusion"><span class="icon-wrap"><i class="fa-solid fa-flag-checkered"></i></span>7. Kết luận chung</a></li>
        </ul>
"""

sidebar_content = base_content[base_content.find('<nav class="sidebar">'):base_content.find('</nav>') + 6]
sidebar_content_new = sidebar_content[:sidebar_content.find('<ul class="nav-links">')] + new_nav + sidebar_content[sidebar_content.find('</ul>')+5:]

script_content = """
    <script>
        // Smooth scroll
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) target.scrollIntoView({ behavior: 'smooth' });
            });
        });

        // Active nav + scroll animations
        const sections = document.querySelectorAll('.section-container');
        const navLinks = document.querySelectorAll('.nav-links a');

        window.addEventListener('scroll', () => {
            let current = '';
            sections.forEach(section => {
                if (scrollY >= (section.offsetTop - 180)) {
                    current = section.getAttribute('id');
                }
            });
            navLinks.forEach(link => {
                link.classList.remove('active');
                if (current && link.getAttribute('href').includes(current)) {
                    link.classList.add('active');
                }
            });
            document.querySelectorAll('.animate-on-scroll').forEach(el => {
                if (el.getBoundingClientRect().top < window.innerHeight - 50) {
                    el.classList.add('is-visible');
                }
            });
        });

        window.dispatchEvent(new Event('scroll'));
    </script>
"""

page = f'''{head}
<body>
    {sidebar_content_new}
    <main class="content">
        {header_content}
        
        {sections_html}
        
        {footer_content}
    </main>
{script_content}
</body>
</html>
'''

with open(os.path.join(v4_dir, "index.html"), "w", encoding='utf-8') as f:
    f.write(page)

print("Seamless index.html generated!")
