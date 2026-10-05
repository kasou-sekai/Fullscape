import AppKit
let out = CommandLine.arguments[1]
for name in ["translate", "quote.bubble.fill", "list.bullet", "ellipsis"] {
 guard let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 24, weight: .medium)) else { fatalError(name) }
 let canvas = NSImage(size: NSSize(width: 64, height: 64))
 canvas.lockFocus()
 NSColor.white.set()
 let size = image.size
 image.draw(in: NSRect(x: (64-size.width)/2, y: (64-size.height)/2, width: size.width, height: size.height))
 canvas.unlockFocus()
 let rep = NSBitmapImageRep(data: canvas.tiffRepresentation!)!
 try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out + "/" + name + ".png"))
}
