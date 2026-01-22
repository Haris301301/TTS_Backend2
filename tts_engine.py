import asyncio
import edge_tts
import sys

TEXT_FILE_PATH = sys.argv[1]
OUTPUT_FILE = sys.argv[2]

VOICE = "id-ID-GadisNeural" 

async def main():
    with open(TEXT_FILE_PATH, "r", encoding="utf-8") as f:
        final_text = f.read()

    # MURNI ALAMI (Seperti Audio Contoh)
    communicate = edge_tts.Communicate(final_text, VOICE)
    
    await communicate.save(OUTPUT_FILE)

if __name__ == "__main__":
    asyncio.run(main())