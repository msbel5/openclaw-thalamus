from common import ROOT, cosine, pass_line, vector

car_image = str(ROOT / "smoke" / "assets" / "car_photo.png")

image = vector("thalamus.vector.embed_image_clip", car_image)
car = vector("thalamus.vector.embed_text_clip", "a car")
banana = vector("thalamus.vector.embed_text_clip", "a banana")

car_score = cosine(image, car)
banana_score = cosine(image, banana)
assert car_score >= 0.25, f"car score too low: {car_score}"
assert banana_score < 0.20, f"banana score too high: {banana_score}"
pass_line("23_crossmodal_real", car=car_score, banana=banana_score, asset=car_image)

