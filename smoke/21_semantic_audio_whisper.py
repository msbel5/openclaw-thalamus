from common import cosine, pass_line, vector

jfk = "/home/msbel/projects-alcyone/whisper.cpp/samples/jfk.wav"
other = "/home/msbel/projects-alcyone/hailo-apps/hailo_apps/python/gen_ai_apps/simple_whisper_chat/audio.wav"

a = vector("thalamus.vector.embed_audio_whisper", jfk)
b = vector("thalamus.vector.embed_audio_whisper", jfk)
c = vector("thalamus.vector.embed_audio_whisper", other)

same = cosine(a, b)
different = cosine(a, c)
assert same >= 0.999, f"same audio cosine too low: {same}"
assert different < 0.95, f"different audio cosine too high: {different}"
pass_line("21_semantic_audio_whisper", same=same, different=different)

