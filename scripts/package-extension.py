"""Build the downloadable, unpacked MV3 extension without external tools."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
target = root / "docs" / "downloads" / "passage-photos-extension.zip"
target.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(target, "w", compression=ZIP_DEFLATED) as archive:
    for source in sorted((root / "extension").glob("*")):
        if source.is_file():
            archive.write(source, "passage-photos-extension/" + source.name)
print(target)
