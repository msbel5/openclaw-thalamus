from common import ROOT, cosine, pass_line, vector

banner = str(ROOT / "smoke" / "assets" / "banner.png")
car = str(ROOT / "smoke" / "assets" / "car_photo.png")

a = vector("thalamus.vector.embed_image_clip", banner)
b = vector("thalamus.vector.embed_image_clip", banner)
c = vector("thalamus.vector.embed_image_clip", car)

same = cosine(a, b)
different = cosine(a, c)
assert same >= 0.999, f"same image cosine too low: {same}"
assert different < 0.95, f"different image cosine too high: {different}"
pass_line("22_semantic_image_clip", same=same, different=different)

