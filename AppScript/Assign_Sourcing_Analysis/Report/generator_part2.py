from generator import build_page, sections, sec5

build_page("solutions.html", "nav_sol", [sec5], "Giải pháp | ISC Report V4")

# For conclusion, we need to wrap sections 6 and 7 in the grid div like the original HTML
conclusion_html = '<div class="grid-2 gap-8">\n' + sections[6] + '\n' + sections[7] + '\n</div>'
build_page("conclusion.html", "nav_conc", [conclusion_html], "Kết luận | ISC Report V4")
print("Part 2 done")
