import * as XLSX from "xlsx";

export type PartListConfidence = "high" | "medium" | "low";

export type PartListDevice = {
  id: string;
  sheetName: string;
  sourceRow: number;
  tag: string;
  customerTag: string;
  rhTagNo: string;
  rhDescription: string;
  description: string;
  position: string;
  range: string;
  setPoint: string;
  alarm: string;
  supplier: string;
  type: string;
  sapNumber: string;
  softwareDb: string;
  softwareIndex: string;
  status: string;
  calibrationCertificate: string;
  comment: string;
  category: string;
  deviceClass: string;
  checklistPack: string;
  suggestedTaskCount: number;
  confidence: PartListConfidence;
  parentRhTagNo: string | null;
  reasons: string[];
};

export type PartListSheetSummary = {
  name: string;
  category: string;
  rows: number;
  devices: number;
  classCounts: Record<string, number>;
};

export type PartListClassSummary = {
  deviceClass: string;
  checklistPack: string;
  devices: number;
  suggestedTaskCount: number;
  estimatedChecklistItems: number;
  sampleTasks: string[];
};

export type PartListReviewItem = {
  tone: "default" | "warning" | "danger";
  title: string;
  detail: string;
};

export type PartListPreview = {
  fileName: string;
  projectHint: {
    customer: string;
    kilnNumber: string;
    projectNumber: string;
    equipmentNumber: string;
    kilnDescription: string;
    drivenSide: string;
    date: string;
    pidDrawing: string;
  };
  totals: {
    devices: number;
    sheets: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    estimatedChecklistItems: number;
    parentChildLinks: number;
    sideVariationRows: number;
  };
  sheets: PartListSheetSummary[];
  classes: PartListClassSummary[];
  reviewItems: PartListReviewItem[];
  devices: PartListDevice[];
};

type Row = Record<string, string>;

type TemplatePack = {
  pack: string;
  taskCount: number;
  sampleTasks: string[];
};

const TEMPLATE_PACKS: Record<string, TemplatePack> = {
  "Thermocouple": {
    pack: "Temperature instrumentation",
    taskCount: 8,
    sampleTasks: [
      "Installed position matches PID",
      "Sensor type and polarity verified",
      "PLC value plausible at ambient temperature",
      "Alarm and setpoint values checked",
    ],
  },
  "Flowmeter": {
    pack: "Flow instrumentation",
    taskCount: 7,
    sampleTasks: [
      "Orientation and process connection checked",
      "Range and unit match part list",
      "Signal or visual reading verified",
      "Calibration certificate checked",
    ],
  },
  "Pressure switch": {
    pack: "Pressure switch",
    taskCount: 8,
    sampleTasks: [
      "Impulse tubing and connection checked",
      "Switching range verified",
      "Switch point tested",
      "PLC alarm/interlock reaction checked",
    ],
  },
  "Pressure instrument": {
    pack: "Pressure instrumentation",
    taskCount: 7,
    sampleTasks: [
      "Installation and process connection checked",
      "Range and unit match part list",
      "Signal value verified",
      "Alarm thresholds checked",
    ],
  },
  "Heating group": {
    pack: "Heating group",
    taskCount: 9,
    sampleTasks: [
      "Group assignment checked",
      "Power circuit identified",
      "Safety interlocks verified",
      "Current balance checked",
    ],
  },
  "Heating element": {
    pack: "Heating element",
    taskCount: 7,
    sampleTasks: [
      "Element position checked",
      "Resistance measured",
      "Insulation test recorded",
      "Terminal tightening checked",
    ],
  },
  "Emergency stop": {
    pack: "Safety circuit",
    taskCount: 10,
    sampleTasks: [
      "Location and label checked",
      "Safety chain wiring verified",
      "Trip test performed",
      "Reset behavior verified",
    ],
  },
  "Motor or fan": {
    pack: "Motor and fan",
    taskCount: 10,
    sampleTasks: [
      "Nameplate data checked",
      "Rotation direction verified",
      "Current draw measured",
      "Interlock and feedback tested",
    ],
  },
  "Valve or actuator": {
    pack: "Valve and actuator",
    taskCount: 9,
    sampleTasks: [
      "Mechanical movement checked",
      "Open/close feedback tested",
      "Default position verified",
      "Manual override checked",
    ],
  },
  "Limit switch": {
    pack: "Limit switch",
    taskCount: 6,
    sampleTasks: [
      "Mounting position checked",
      "Switching point adjusted",
      "Signal to PLC verified",
      "Label checked",
    ],
  },
  "Actor or part": {
    pack: "General actor",
    taskCount: 5,
    sampleTasks: [
      "Installed item matches part list",
      "Position checked",
      "Label checked",
      "Function verified where applicable",
    ],
  },
  "General device": {
    pack: "General device",
    taskCount: 4,
    sampleTasks: [
      "Installed item matches part list",
      "Position checked",
      "Technical data checked",
      "Documentation status checked",
    ],
  },
};

const HEADER_KEYS: Record<string, string> = {
  "customer tag complete": "tag",
  "customer device tag": "customerTag",
  "rh tag descr": "rhDescription",
  "rh tag no": "rhTagNo",
  description: "description",
  position: "position",
  "range min": "rangeMin",
  "range max": "rangeMax",
  unit: "unit",
  "set point": "setPoint",
  "alarm low": "alarmLow",
  "alarm high": "alarmHigh",
  "switch low": "switchLow",
  "switch high": "switchHigh",
  "default position": "defaultPosition",
  power: "power",
  "process connection": "processConnection",
  "ip class": "ipClass",
  hart: "hart",
  supplier: "supplier",
  type: "type",
  "sap number": "sapNumber",
  "sap description": "sapDescription",
  "software db": "softwareDb",
  "software index": "softwareIndex",
  "standard adr": "standardAddress",
  "f adr ch1": "failsafeAddressCh1",
  "f adr ch2": "failsafeAddressCh2",
  status: "status",
  "calibration certificate": "calibrationCertificate",
  "ul csa certification": "ulCsaCertification",
  comment: "comment",
};

function compact(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, " ").trim();
}

function normalize(value: unknown): string {
  return compact(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function projectValue(rows: unknown[][], label: string): string {
  const wanted = normalize(label);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      if (normalize(row[i]) === wanted) return compact(row[i + 1]);
    }
  }
  return "";
}

function categoryFromSheet(sheetName: string): string | null {
  const name = normalize(sheetName);
  if (name.includes("temperature")) return "Temperature";
  if (name.includes("flow")) return "Flow";
  if (name.includes("pressure")) return "Pressure";
  if (name.includes("position")) return "Position";
  if (name.includes("heating")) return "Heating";
  if (name.includes("motor") || name.includes("electrical") || name.includes("pneumatic")) return "Motor/electrical actor";
  if (name.includes("manual actor")) return "Manual actor";
  if (name.includes("other actors")) return "Other actor";
  if (name.includes("other measurement")) return "Other measurement";
  return null;
}

function headerKey(value: unknown): string | null {
  const key = normalize(value);
  return HEADER_KEYS[key] ?? null;
}

function rowValue(row: Row, key: string): string {
  return compact(row[key]);
}

function joinRange(row: Row): string {
  const min = rowValue(row, "rangeMin");
  const max = rowValue(row, "rangeMax");
  const unit = rowValue(row, "unit");
  if (!min && !max) return unit;
  return [min, max].filter(Boolean).join(" - ") + (unit ? ` ${unit}` : "");
}

function joinAlarm(row: Row): string {
  const parts = [
    rowValue(row, "alarmLow") ? `AL ${rowValue(row, "alarmLow")}` : "",
    rowValue(row, "alarmHigh") ? `AH ${rowValue(row, "alarmHigh")}` : "",
    rowValue(row, "switchLow") ? `SL ${rowValue(row, "switchLow")}` : "",
    rowValue(row, "switchHigh") ? `SH ${rowValue(row, "switchHigh")}` : "",
  ];
  return parts.filter(Boolean).join(", ");
}

function classify(row: Row, category: string): Pick<PartListDevice, "deviceClass" | "checklistPack" | "suggestedTaskCount" | "confidence" | "reasons"> {
  const rhTagNo = rowValue(row, "rhTagNo");
  const tag = rowValue(row, "tag");
  const text = normalize([
    category,
    rowValue(row, "tag"),
    rowValue(row, "customerTag"),
    rowValue(row, "rhDescription"),
    rowValue(row, "description"),
    rowValue(row, "type"),
    rowValue(row, "supplier"),
  ].join(" "));

  let deviceClass = "General device";
  let confidence: PartListConfidence = "medium";
  const reasons: string[] = [];

  if (category === "Temperature" || text.includes("thermocouple") || text.includes("temperature")) {
    deviceClass = "Thermocouple";
    confidence = category === "Temperature" ? "high" : "medium";
    reasons.push("temperature sheet or thermocouple wording");
  } else if (category === "Flow" || text.includes("flowmeter") || text.includes("flow meter")) {
    deviceClass = "Flowmeter";
    confidence = category === "Flow" ? "high" : "medium";
    reasons.push("flow sheet or flowmeter wording");
  } else if (category === "Pressure" || text.includes("pressure")) {
    if (text.includes("switch") || normalize(tag).startsWith("ps")) {
      deviceClass = "Pressure switch";
      reasons.push("pressure switch wording or PS tag");
    } else {
      deviceClass = "Pressure instrument";
      reasons.push("pressure sheet or pressure wording");
    }
    confidence = category === "Pressure" ? "high" : "medium";
  } else if (category === "Heating") {
    if (text.includes("group") || (rhTagNo && !rhTagNo.includes("."))) {
      deviceClass = "Heating group";
      reasons.push("heating group row");
    } else {
      deviceClass = "Heating element";
      reasons.push("heating child row");
    }
    confidence = "high";
  } else if (text.includes("emergency") || text.includes("e stop") || text.includes("safe plc")) {
    deviceClass = "Emergency stop";
    confidence = "high";
    reasons.push("safety or emergency wording");
  } else if (text.includes("fan") || text.includes("motor") || text.includes("pump")) {
    deviceClass = "Motor or fan";
    confidence = "medium";
    reasons.push("motor, fan, or pump wording");
  } else if (text.includes("valve") || text.includes("actuator") || text.includes("damper") || text.includes("flap")) {
    deviceClass = "Valve or actuator";
    confidence = "medium";
    reasons.push("valve, actuator, damper, or flap wording");
  } else if (text.includes("limit switch") || text.includes("proximity switch")) {
    deviceClass = "Limit switch";
    confidence = "medium";
    reasons.push("switch wording");
  } else if (category.includes("actor")) {
    deviceClass = "Actor or part";
    confidence = "medium";
    reasons.push("actor sheet");
  } else {
    confidence = "low";
    reasons.push("no strong rule matched");
  }

  const pack = TEMPLATE_PACKS[deviceClass] ?? TEMPLATE_PACKS["General device"];
  return {
    deviceClass,
    checklistPack: pack.pack,
    suggestedTaskCount: pack.taskCount,
    confidence,
    reasons,
  };
}

function parentRhTagNo(rhTagNo: string): string | null {
  if (!rhTagNo.includes(".")) return null;
  return rhTagNo.split(".").slice(0, -1).join(".");
}

function toRows(worksheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  }) as unknown[][];
}

function parseDeviceSheet(sheetName: string, worksheet: XLSX.WorkSheet): { devices: PartListDevice[]; summary: PartListSheetSummary } | null {
  const category = categoryFromSheet(sheetName);
  if (!category) return null;

  const rows = toRows(worksheet);
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalize(cell) === "customer tag complete"));
  if (headerIndex < 0) return null;

  const headers = rows[headerIndex].map(headerKey);
  const devices: PartListDevice[] = [];

  rows.slice(headerIndex + 1).forEach((source, idx) => {
    const row: Row = {};
    headers.forEach((key, col) => {
      if (key) row[key] = compact(source[col]);
    });

    const tag = rowValue(row, "tag");
    const rhTagNo = rowValue(row, "rhTagNo");
    const description = rowValue(row, "description");
    const rhDescription = rowValue(row, "rhDescription");
    const customerTag = rowValue(row, "customerTag");

    if (!tag && !rhTagNo && !description && !rhDescription && !customerTag) return;

    const classification = classify(row, category);
    const sourceRow = headerIndex + idx + 2;
    devices.push({
      id: `${sheetName}:${sourceRow}`,
      sheetName,
      sourceRow,
      tag,
      customerTag,
      rhTagNo,
      rhDescription,
      description,
      position: rowValue(row, "position"),
      range: joinRange(row),
      setPoint: rowValue(row, "setPoint"),
      alarm: joinAlarm(row),
      supplier: rowValue(row, "supplier"),
      type: rowValue(row, "type"),
      sapNumber: rowValue(row, "sapNumber"),
      softwareDb: rowValue(row, "softwareDb"),
      softwareIndex: rowValue(row, "softwareIndex"),
      status: rowValue(row, "status"),
      calibrationCertificate: rowValue(row, "calibrationCertificate"),
      comment: rowValue(row, "comment"),
      category,
      parentRhTagNo: parentRhTagNo(rhTagNo),
      ...classification,
    });
  });

  const classCounts = devices.reduce<Record<string, number>>((acc, item) => {
    acc[item.deviceClass] = (acc[item.deviceClass] ?? 0) + 1;
    return acc;
  }, {});

  return {
    devices,
    summary: {
      name: sheetName,
      category,
      rows: Math.max(0, rows.length - headerIndex - 1),
      devices: devices.length,
      classCounts,
    },
  };
}

function countSideVariationRows(workbook: XLSX.WorkBook): number {
  const sheetName = workbook.SheetNames.find((name) => normalize(name).includes("different parts"));
  if (!sheetName) return 0;

  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) return 0;

  const rows = toRows(worksheet);
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalize(cell) === "tag number"));
  if (headerIndex < 0) return 0;

  return rows.slice(headerIndex + 2).filter((row) => compact(row[0]) && compact(row[1])).length;
}

function buildClassSummary(devices: PartListDevice[]): PartListClassSummary[] {
  const byClass = new Map<string, PartListClassSummary>();

  devices.forEach((device) => {
    const existing = byClass.get(device.deviceClass);
    const pack = TEMPLATE_PACKS[device.deviceClass] ?? TEMPLATE_PACKS["General device"];
    if (!existing) {
      byClass.set(device.deviceClass, {
        deviceClass: device.deviceClass,
        checklistPack: device.checklistPack,
        devices: 1,
        suggestedTaskCount: device.suggestedTaskCount,
        estimatedChecklistItems: device.suggestedTaskCount,
        sampleTasks: pack.sampleTasks,
      });
      return;
    }
    existing.devices += 1;
    existing.estimatedChecklistItems += device.suggestedTaskCount;
  });

  return Array.from(byClass.values()).sort((a, b) => b.devices - a.devices || a.deviceClass.localeCompare(b.deviceClass));
}

function buildReviewItems(preview: Omit<PartListPreview, "reviewItems">): PartListReviewItem[] {
  const missingTags = preview.devices.filter((d) => !d.tag && !d.rhTagNo).length;
  const lowConfidence = preview.totals.lowConfidence;
  const withCalibration = preview.devices.filter((d) => d.calibrationCertificate).length;
  const withSoftware = preview.devices.filter((d) => d.softwareDb || d.softwareIndex).length;
  const sideRows = preview.totals.sideVariationRows;

  const items: PartListReviewItem[] = [
    {
      tone: lowConfidence > 0 ? "warning" : "default",
      title: `${lowConfidence} low-confidence mappings`,
      detail: lowConfidence > 0
        ? "These rows need engineer review before checklist generation."
        : "All parsed rows matched at least one rule.",
    },
    {
      tone: missingTags > 0 ? "warning" : "default",
      title: `${missingTags} rows without tag numbers`,
      detail: missingTags > 0
        ? "Rows without a tag can still become tasks, but should not become standalone devices automatically."
        : "Every parsed device has a customer tag or RH tag number.",
    },
    {
      tone: "default",
      title: `${preview.totals.parentChildLinks} parent-child links`,
      detail: "Dotted RH tag numbers can be grouped under their parent device or heating group.",
    },
    {
      tone: "default",
      title: `${withSoftware} rows with software references`,
      detail: "Software DB/index data can drive PLC and HMI verification tasks.",
    },
    {
      tone: "default",
      title: `${withCalibration} rows with calibration info`,
      detail: "Calibration certificate fields can drive document checks.",
    },
  ];

  if (sideRows > 0) {
    items.push({
      tone: "default",
      title: `${sideRows} side-specific parts`,
      detail: "Driven-side variations can be applied when creating each kiln.",
    });
  }

  return items;
}

export async function previewPartList(file: File): Promise<PartListPreview> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  const overviewSheet = workbook.Sheets["Overview"];
  const overviewRows = overviewSheet ? toRows(overviewSheet) : [];

  const devices: PartListDevice[] = [];
  const sheets: PartListSheetSummary[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) return;
    const parsed = parseDeviceSheet(sheetName, worksheet);
    if (!parsed) return;
    devices.push(...parsed.devices);
    sheets.push(parsed.summary);
  });

  const classes = buildClassSummary(devices);
  const parentChildLinks = devices.filter((d) => d.parentRhTagNo).length;
  const sideVariationRows = countSideVariationRows(workbook);

  const previewWithoutReview: Omit<PartListPreview, "reviewItems"> = {
    fileName: file.name,
    projectHint: {
      customer: projectValue(overviewRows, "Customer:"),
      kilnNumber: projectValue(overviewRows, "Kiln Number:"),
      projectNumber: projectValue(overviewRows, "Project Number:"),
      equipmentNumber: projectValue(overviewRows, "Equipment-No:"),
      kilnDescription: projectValue(overviewRows, "Kiln description:"),
      drivenSide: projectValue(overviewRows, "Kiln driven side:"),
      date: projectValue(overviewRows, "Date:"),
      pidDrawing: projectValue(overviewRows, "PID drawing Number:"),
    },
    totals: {
      devices: devices.length,
      sheets: sheets.length,
      highConfidence: devices.filter((d) => d.confidence === "high").length,
      mediumConfidence: devices.filter((d) => d.confidence === "medium").length,
      lowConfidence: devices.filter((d) => d.confidence === "low").length,
      estimatedChecklistItems: devices.reduce((sum, item) => sum + item.suggestedTaskCount, 0),
      parentChildLinks,
      sideVariationRows,
    },
    sheets,
    classes,
    devices,
  };

  return {
    ...previewWithoutReview,
    reviewItems: buildReviewItems(previewWithoutReview),
  };
}

export function downloadPartListPreview(preview: PartListPreview) {
  const blob = new Blob([JSON.stringify(preview, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${preview.fileName.replace(/\.[^.]+$/, "")}-import-preview.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
