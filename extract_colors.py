from PIL import Image
import sys

img_path = r"C:\Users\7rand\.gemini\antigravity-ide\brain\696fbd22-c222-4bcd-9589-beeaa7ace6ea\media__1780246424299.png"
img = Image.open(img_path)
width, height = img.size

# Sample pixels along the vertical center
colors = []
for y in range(0, height, height // 16):
    r, g, b = img.getpixel((width // 2, y))[:3]
    # filter out white/transparent background (assuming not #FFFFFF exactly or alpha=0)
    if r > 240 and g > 240 and b > 240:
        continue
    hex_color = "#{:02x}{:02x}{:02x}".format(r, g, b)
    if hex_color not in colors:
        colors.append(hex_color)

print("Found colors:", colors)
