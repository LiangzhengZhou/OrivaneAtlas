import {
  Bold,
  Braces,
  Code,
  FileText,
  Heading,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Paperclip,
  Quote,
  Sigma,
  Sparkles,
  Strikethrough,
  Table,
} from "lucide-react";
import type { MarkdownCommandId } from "./markdown-commands";

const icons = {
  heading: Heading,
  bold: Bold,
  italic: Italic,
  strike: Strikethrough,
  "inline-code": Code,
  code: Braces,
  link: Link,
  wiki: FileText,
  image: Image,
  formula: Sigma,
  table: Table,
  bullet: List,
  numbered: ListOrdered,
  task: ListChecks,
  quote: Quote,
  divider: Minus,
  file: Paperclip,
  atlas: Sparkles,
};

export function MarkdownCommandIcon({
  command,
}: {
  command: MarkdownCommandId;
}) {
  const Icon = icons[command];
  return <Icon size={16} aria-hidden="true" />;
}
