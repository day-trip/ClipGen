from clipgen.mochi import MochiModel

model = MochiModel()
print("INIT")
model.initialize([0, 1])
print("GENERATE")
output_path = model.generate({"prompt": "A cat playing with a ball of yarn in slow motion"})
print("CLEANUP")
model.cleanup()
