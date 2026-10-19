import { StyleSheet, View } from 'react-native';

// Dark on white whatever the theme, so every camera can read it (the web's live screen uses the same pair).
const DARK = '#17131c';
const LIGHT = '#ffffff';
/** Light modules around the code, inside the white box. */
const QUIET = 2;

type Run = { dark: boolean; len: number };

/** Each row as runs of equal modules, so a row is a handful of views instead of one per module. */
function toRuns(rows: string[]): Run[][] {
  return rows.map((row) => {
    const runs: Run[] = [];
    for (let i = 0; i < row.length; ) {
      const dark = row[i] === '1';
      let j = i;
      while (j < row.length && (row[j] === '1') === dark) j++;
      runs.push({ dark, len: j - i });
      i = j;
    }
    return runs;
  });
}

/**
 * A QR code drawn from its modules (the server sends them row by row, "1" =
 * dark), so the app needs no QR library. Modules are whole points wide, so
 * there are no hairline seams for a camera to trip on.
 */
export function QrCode({ rows, size, label, dimmed = false }: { rows: string[]; size: number; label: string; dimmed?: boolean }) {
  const n = rows.length || 1;
  const m = Math.max(1, Math.floor(size / (n + QUIET * 2)));
  const side = m * (n + QUIET * 2);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={[styles.box, { width: side, height: side, padding: m * QUIET, opacity: dimmed ? 0.3 : 1 }]}>
      {toRuns(rows).map((runs, r) => (
        <View key={r} style={styles.row}>
          {runs.map((run, i) => (
            <View key={i} style={{ width: run.len * m, height: m, backgroundColor: run.dark ? DARK : LIGHT }} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: LIGHT },
  row: { flexDirection: 'row' },
});
