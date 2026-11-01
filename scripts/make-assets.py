from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parents[1] / 'assets'
out.mkdir(exist_ok=True)
def symbol(size, background, transparent=False):
    image = Image.new('RGBA', (size,size), (0,0,0,0) if transparent else background)
    d=ImageDraw.Draw(image)
    def rect(box, r, fill): d.rounded_rectangle(tuple(int(x*size) for x in box),radius=int(r*size),fill=fill)
    rect((.27,.25,.73,.77),.07,'#F1F8EF')
    rect((.34,.34,.57,.38),.018,'#16846B')
    rect((.34,.45,.63,.49),.018,'#A8CDBB')
    rect((.34,.56,.63,.60),.018,'#A8CDBB')
    d.ellipse((int(.57*size),int(.18*size),int(.79*size),int(.40*size)),fill='#B6D7AA')
    d.line((int(.62*size),int(.37*size),int(.75*size),int(.23*size)),fill='#387B5B',width=max(2,int(.018*size)))
    return image
symbol(1024,'#16846B').convert('RGB').save(out/'icon.png')
symbol(1024,'#16846B',True).save(out/'adaptive-icon.png')
symbol(256,'#F4F7F5').save(out/'splash.png')
symbol(64,'#16846B').save(out/'favicon.png')
print('Created app icon, adaptive icon, splash and favicon.')
