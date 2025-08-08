import asyncio
from clipgen.mochi_model import MochiModel

async def main():
    model = MochiModel()
    print("INIT")
    await model.initialize([0, 1])
    print("GENERATE")
    output_path = await model.generate({"prompt": "A cat playing with a ball of yarn in slow motion"})
    print("CLEANUP")
    await model.cleanup()
    return output_path

# Run the async function
if __name__ == "__main__":
    result = asyncio.run(main())
    print(f"Generated: {result}")
