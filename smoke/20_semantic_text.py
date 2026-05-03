from common import cosine, pass_line, vector

btc = vector("thalamus.vector.embed_text_semantic", "BTC fiyatı")
bitcoin = vector("thalamus.vector.embed_text_semantic", "Bitcoin değeri")
cats = vector("thalamus.vector.embed_text_semantic", "kediler bahçede")

positive = cosine(btc, bitcoin)
negative = cosine(btc, cats)
assert positive >= 0.5, f"BTC/Bitcoin cosine too low: {positive}"
assert negative < 0.3, f"BTC/cats cosine too high: {negative}"
pass_line("20_semantic_text", btc_bitcoin=positive, btc_cats=negative)

