const OpenAI = require("openai");

const client = OpenAI({
    api_key: "ddc-a4f-98210eaf96ef46e7b3b81ba0f4b3e698",
    base_url: "https://api.a4f.co/v1/audio/speech"
})

response = client.audio.speech.create(
    model = "provider-3/tts-1",
    voice = "alloy",
    input = "Hello, world! This is a test of the A4F text-to-speech API."
)

response.stream_to_file("speech.mp3")
print("Audio saved to speech.mp3")