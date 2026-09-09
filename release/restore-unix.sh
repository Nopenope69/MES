#!/bin/bash
echo "Assembling mes-simulator-win.exe from binary chunks..."
cat release/mes-simulator-win.exe.part* > release/mes-simulator-win.exe
chmod +x release/mes-simulator-win.exe
echo "Done! release/mes-simulator-win.exe is ready."
