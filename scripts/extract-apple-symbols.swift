import AppKit

let out = CommandLine.arguments[1]
let rasterSize = 256
let outputSize = 128
for name in ["translate", "quote.bubble.fill", "list.bullet", "ellipsis"] {
    guard let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
        .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 96, weight: .semibold)),
        let source = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: rasterSize,
            pixelsHigh: rasterSize, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
            isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
        let context = NSGraphicsContext(bitmapImageRep: source)
    else { fatalError(name) }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    image.draw(in: NSRect(x: (CGFloat(rasterSize) - image.size.width) / 2,
        y: (CGFloat(rasterSize) - image.size.height) / 2,
        width: image.size.width, height: image.size.height))
    NSGraphicsContext.restoreGraphicsState()

    // Center the visible glyph, removing SF Symbols' asymmetric baseline padding.
    var minX = rasterSize, minY = rasterSize, maxX = 0, maxY = 0
    for y in 0..<rasterSize {
        for x in 0..<rasterSize where (source.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.01 {
            minX = min(minX, x); minY = min(minY, y)
            maxX = max(maxX, x); maxY = max(maxY, y)
        }
    }
    guard minX <= maxX, minY <= maxY,
        let cropped = source.cgImage?.cropping(to: CGRect(x: minX, y: minY,
            width: maxX - minX + 1, height: maxY - minY + 1)),
        let output = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: outputSize,
            pixelsHigh: outputSize, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
            isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
        let outputContext = NSGraphicsContext(bitmapImageRep: output)
    else { fatalError(name) }
    let scale = 112 / CGFloat(max(cropped.width, cropped.height))
    let size = NSSize(width: CGFloat(cropped.width) * scale, height: CGFloat(cropped.height) * scale)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = outputContext
    outputContext.imageInterpolation = .high
    NSImage(cgImage: cropped, size: size).draw(in: NSRect(
        x: (CGFloat(outputSize) - size.width) / 2, y: (CGFloat(outputSize) - size.height) / 2,
        width: size.width, height: size.height))
    NSGraphicsContext.restoreGraphicsState()
    try output.representation(using: .png, properties: [:])!.write(
        to: URL(fileURLWithPath: out + "/" + name + ".png"))
}
