import fitz
from pathlib import Path
pdf = Path('attached_assets/Binance_Futures_Position_History_202608201407UTC+5_8d5486b9_1787235198093.pdf')
out = Path('.agents/outputs/position_history_pages')
out.mkdir(parents=True, exist_ok=True)
doc = fitz.open(pdf)
print('pages', doc.page_count)
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(2,2), alpha=False)
    path = out / f'page-{i+1}.png'
    pix.save(path)
    print(path)
