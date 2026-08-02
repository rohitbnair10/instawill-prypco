/**
 * Draft-will PDF generation — renders the Schedule 1 structure to a real PDF
 * using @react-pdf/renderer (works in a plain Node process, no headless
 * browser needed — safe on Vercel serverless). This is the "draft will PDF"
 * document link in the ops portal package (§1.5/§1.6): the app generates it,
 * stores it the same way as client-uploaded documents, and links it so ops
 * has the will itself ready to attach.
 *
 * Server-only.
 */
import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { buildSchedule1, type Segment } from "./schedule1";
import type { Identity, StructuredWill } from "./types";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: "Times-Roman", lineHeight: 1.5 },
  kicker: { fontSize: 9, color: "#5C6B7E", textTransform: "uppercase", letterSpacing: 1 },
  h1: { fontSize: 16, fontFamily: "Times-Bold", marginTop: 2, marginBottom: 2 },
  sub: { fontSize: 9, color: "#5C6B7E", marginBottom: 4 },
  mock: { fontSize: 8, color: "#C08A2E", marginBottom: 16 },
  clauseTitle: { fontSize: 10, fontFamily: "Times-Bold", textTransform: "uppercase", marginTop: 10, marginBottom: 2 },
  para: { marginBottom: 3 },
  slotFilled: { fontFamily: "Times-Bold" },
  slotEmpty: { color: "#5C6B7E", fontStyle: "italic" },
  hr: { borderBottomWidth: 1, borderBottomColor: "#D9D2C4", marginVertical: 10 },
  voidBox: { marginTop: 12, padding: 8, backgroundColor: "#FBEDE7", color: "#B06A4F", fontSize: 9 },
});

function Segments({ segments }: { segments: Segment[] }) {
  return (
    <Text style={styles.para}>
      {segments.map((s, i) =>
        s.t === "text" ? (
          <Text key={i}>{s.v}</Text>
        ) : s.v === null ? (
          <Text key={i} style={styles.slotEmpty}>
            [{s.placeholder}]
          </Text>
        ) : (
          <Text key={i} style={styles.slotFilled}>
            {s.v}
          </Text>
        )
      )}
    </Text>
  );
}

function WillPdfDocument({
  structured,
  identity,
}: {
  structured: StructuredWill | null;
  identity: Identity | null;
}) {
  const sched = buildSchedule1(structured, identity);
  return (
    <Document title="DIFC Schedule 1 — Draft Will">
      <Page size="A4" style={styles.page}>
        <Text style={styles.kicker}>DIFC Wills &amp; Probate Registry</Text>
        <Text style={styles.h1}>Last Will &amp; Testament</Text>
        <Text style={styles.sub}>Schedule 1 — Form of Will 1 (Full Will)</Text>
        <Text style={styles.mock}>Illustrative structure — not registration-grade legal text</Text>

        {sched.clauses.map((c) => (
          <View key={c.n} wrap={false}>
            <Text style={styles.clauseTitle}>
              {c.n}. {c.title}
            </Text>
            {c.body.map((para, i) => (
              <Segments key={i} segments={para} />
            ))}
          </View>
        ))}

        <View style={styles.hr} />
        <Text style={styles.clauseTitle}>Execution</Text>
        {sched.witnessBlock.map((para, i) => (
          <Segments key={i} segments={para} />
        ))}

        <View style={styles.voidBox}>
          <Text>{sched.voidCondition}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderWillPdf(
  structured: StructuredWill | null,
  identity: Identity | null
): Promise<Buffer> {
  return renderToBuffer(<WillPdfDocument structured={structured} identity={identity} />);
}
