// macOS 本地PDF OCR。图片仅在内存中，输出文件只能位于项目 local/ 目录。
import Foundation
import PDFKit
import Vision
import AppKit

func fail(_ text: String) -> Never { fputs(text + "\n", stderr); exit(1) }
guard CommandLine.arguments.count == 3 else { fail("用法：extract-resume 输入.pdf local/resume.json") }
let source = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
let destination = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
let local = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("local").standardizedFileURL
let resolvedDestination = destination.resolvingSymlinksInPath().path
let resolvedLocal = local.resolvingSymlinksInPath().path
guard resolvedDestination.hasPrefix(resolvedLocal + "/") else { fail("真实简历只能输出到项目 local/ 目录") }
guard let doc = PDFDocument(url: source) else { fail("无法读取PDF") }
var pages: [String] = []
for index in 0..<doc.pageCount {
    guard let page = doc.page(at: index) else { fail("无法读取PDF页") }
    let image = page.thumbnail(of: NSSize(width: 2000, height: 2800), for: .mediaBox)
    var rect = NSRect(origin: .zero, size: image.size)
    guard let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { fail("PDF渲染失败") }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    pages.append(lines.joined(separator: "\n"))
}
let text = pages.joined(separator: "\n\n")
guard text.count > 100 else { fail("OCR未提取到足够文字") }
let name = source.deletingPathExtension().lastPathComponent.components(separatedBy: "_").first ?? ""
func firstMatch(_ pattern: String) -> String {
    guard let range = text.range(of: pattern, options: .regularExpression) else { return "" }
    return String(text[range])
}
let result: [String: Any] = [
    "schemaVersion": 1,
    "personal": ["name": name, "email": firstMatch("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"), "phone": firstMatch("1[3-9][0-9]{9}")],
    "education": [], "skills": [], "experience": [], "projects": [], "publications": [],
    "resumeText": text
]
try FileManager.default.createDirectory(at: local, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
try data.write(to: destination, options: .atomic)
try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
print("本地OCR完成：\(doc.pageCount)页，\(text.count)字符；简历内容未写入日志。")
