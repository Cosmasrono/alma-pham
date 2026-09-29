import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const STAFF: { username: string; name: string; role: string; password: string }[] =
  [
    { username: "admin", name: "Administrator", role: "admin", password: "admin123" },
    { username: "reception", name: "Front Desk", role: "receptionist", password: "reception123" },
    { username: "nurse", name: "Triage Nurse", role: "nurse", password: "nurse123" },
    { username: "lab", name: "Lab Tech", role: "lab", password: "lab123" },
    { username: "radiology", name: "Radiology Tech", role: "radiology", password: "radiology123" },
    { username: "pharmacy", name: "Pharmacist", role: "pharmacist", password: "pharmacy123" },
    { username: "otieno", name: "Dr. Otieno", role: "doctor", password: "doctor123" },
    { username: "achieng", name: "Dr. Achieng", role: "doctor", password: "doctor123" },
    { username: "kamau", name: "Dr. Kamau", role: "doctor", password: "doctor123" },
    { username: "wanjiru", name: "Dr. Wanjiru", role: "doctor", password: "doctor123" },
  ];


  
// Pharmacy catalog: common stock for a small Kenyan clinic (prices in KSh).
const MEDICINES: {
  name: string;
  strength: string;
  form: string;
  unitPrice: number;
  stock: number;
}[] = [
  { name: "Paracetamol", strength: "500mg", form: "tablet", unitPrice: 5, stock: 500 },
  { name: "Ibuprofen", strength: "400mg", form: "tablet", unitPrice: 10, stock: 300 },
  { name: "Amoxicillin", strength: "500mg", form: "capsule", unitPrice: 15, stock: 200 },
  { name: "Amoxicillin", strength: "125mg/5ml", form: "syrup", unitPrice: 250, stock: 40 },
  { name: "Artemether-Lumefantrine", strength: "20/120", form: "tablet", unitPrice: 30, stock: 150 },
  { name: "Metronidazole", strength: "400mg", form: "tablet", unitPrice: 8, stock: 250 },
  { name: "Ciprofloxacin", strength: "500mg", form: "tablet", unitPrice: 20, stock: 150 },
  { name: "Cetirizine", strength: "10mg", form: "tablet", unitPrice: 10, stock: 200 },
  { name: "Omeprazole", strength: "20mg", form: "capsule", unitPrice: 15, stock: 180 },
  { name: "ORS", strength: "20.5g", form: "sachet", unitPrice: 20, stock: 100 },
  { name: "Zinc sulphate", strength: "20mg", form: "tablet", unitPrice: 10, stock: 120 },
  { name: "Salbutamol", strength: "100mcg", form: "inhaler", unitPrice: 450, stock: 25 },
  { name: "Hydrocortisone", strength: "1%", form: "cream", unitPrice: 150, stock: 30 },
  { name: "Diclofenac", strength: "1%", form: "gel", unitPrice: 200, stock: 30 },
  { name: "Vitamin B complex", strength: "—", form: "tablet", unitPrice: 5, stock: 300 },
];

// Priced catalog of services the doctor can order. Labs carry the parameter
// panel the technician fills in, with the reference ranges results are flagged
// against; radiology and procedures report a free-text finding instead.
const SERVICES: {
  name: string;
  orderType: "lab" | "radiology" | "procedure";
  category: string;
  price: number;
  parameters?: {
    name: string;
    unit: string;
    refLow?: number;
    refHigh?: number;
  }[];
}[] = [
  {
    name: "Full haemogram (CBC)",
    orderType: "lab",
    category: "haematology",
    price: 500,
    parameters: [
      { name: "WBC", unit: "10^9/L", refLow: 4, refHigh: 11 },
      { name: "RBC", unit: "10^12/L", refLow: 4.5, refHigh: 5.9 },
      { name: "Haemoglobin", unit: "g/dL", refLow: 12, refHigh: 16 },
      { name: "Haematocrit", unit: "%", refLow: 36, refHigh: 48 },
      { name: "Platelets", unit: "10^9/L", refLow: 150, refHigh: 450 },
    ],
  },
  {
    name: "Malaria RDT",
    orderType: "lab",
    category: "microbiology",
    price: 300,
    parameters: [{ name: "Result", unit: "" }], // positive / negative
  },
  {
    name: "Malaria microscopy (BS)",
    orderType: "lab",
    category: "microbiology",
    price: 350,
    parameters: [
      { name: "Parasites seen", unit: "" },
      { name: "Parasite density", unit: "/µL" },
    ],
  },
  {
    name: "Urinalysis",
    orderType: "lab",
    category: "urinalysis",
    price: 300,
    parameters: [
      { name: "Colour", unit: "" },
      { name: "Protein", unit: "" },
      { name: "Glucose", unit: "" },
      { name: "Leucocytes", unit: "/hpf" },
      { name: "Pus cells", unit: "/hpf" },
    ],
  },
  {
    name: "Blood sugar (RBS)",
    orderType: "lab",
    category: "biochemistry",
    price: 200,
    parameters: [{ name: "Glucose", unit: "mmol/L", refLow: 3.9, refHigh: 7.8 }],
  },
  {
    name: "Urea, electrolytes & creatinine",
    orderType: "lab",
    category: "biochemistry",
    price: 1800,
    parameters: [
      { name: "Sodium", unit: "mmol/L", refLow: 135, refHigh: 145 },
      { name: "Potassium", unit: "mmol/L", refLow: 3.5, refHigh: 5.1 },
      { name: "Urea", unit: "mmol/L", refLow: 2.5, refHigh: 7.1 },
      { name: "Creatinine", unit: "µmol/L", refLow: 62, refHigh: 115 },
    ],
  },
  {
    name: "Liver function test",
    orderType: "lab",
    category: "biochemistry",
    price: 2000,
    parameters: [
      { name: "ALT", unit: "U/L", refLow: 7, refHigh: 56 },
      { name: "AST", unit: "U/L", refLow: 10, refHigh: 40 },
      { name: "Total bilirubin", unit: "µmol/L", refLow: 5, refHigh: 21 },
      { name: "Albumin", unit: "g/L", refLow: 35, refHigh: 50 },
    ],
  },
  {
    name: "HIV rapid test",
    orderType: "lab",
    category: "serology",
    price: 0, // free under the national programme
    parameters: [{ name: "Result", unit: "" }],
  },
  {
    name: "Widal test",
    orderType: "lab",
    category: "serology",
    price: 500,
    parameters: [
      { name: "S. typhi O", unit: "titre" },
      { name: "S. typhi H", unit: "titre" },
    ],
  },
  {
    name: "Pregnancy test (hCG)",
    orderType: "lab",
    category: "serology",
    price: 200,
    parameters: [{ name: "Result", unit: "" }],
  },
  { name: "Chest X-ray", orderType: "radiology", category: "imaging", price: 1500 },
  { name: "Abdominal ultrasound", orderType: "radiology", category: "imaging", price: 2000 },
  { name: "Obstetric ultrasound", orderType: "radiology", category: "imaging", price: 2500 },
  { name: "Wound dressing", orderType: "procedure", category: "other", price: 500 },
  { name: "Suturing (minor)", orderType: "procedure", category: "other", price: 1500 },
  { name: "Injection administration", orderType: "procedure", category: "other", price: 200 },
  { name: "Nebulisation", orderType: "procedure", category: "other", price: 800 },
];

async function ensureServiceCatalog() {
  if ((await prisma.serviceItem.count()) > 0) {
    console.log("Service catalog already present — skipping.");
    return;
  }
  await prisma.serviceItem.createMany({
    data: SERVICES.map((s) => ({ ...s, parameters: s.parameters ?? [] })),
  });
  console.log(`Seeded ${SERVICES.length} catalog services.`);
}

async function ensureMedicines() {
  if ((await prisma.medicine.count()) > 0) {
    console.log("Medicines already present — skipping catalog seed.");
    return;
  }
  await prisma.medicine.createMany({ data: MEDICINES });
  console.log(`Seeded ${MEDICINES.length} medicines.`);
}

async function ensureStaff() {
  for (const s of STAFF) {
    const existing = await prisma.user.findUnique({
      where: { username: s.username },
    });
    if (existing) continue;
    await prisma.user.create({
      data: {
        username: s.username,
        name: s.name,
        role: s.role,
        passwordHash: await bcrypt.hash(s.password, 10),
        active: true,
      },
    });
    console.log(`Created user '${s.username}' (${s.role}).`);
  }
}

async function seedDemoPatients() {
  const doctors = await prisma.user.findMany({
    where: { role: "doctor", active: true },
    orderBy: { name: "asc" },
  });
  const doc1 = doctors[0]?.id ?? null;
  const doc2 = doctors[1]?.id ?? doc1;

  const amina = await prisma.patient.create({
    data: {
      mrn: "P-0001",
      nationalId: "29871234",
      firstName: "Amina",
      lastName: "Yusuf",
      gender: "female",
      age: 29,
      phone: "0712 000111",
    },
  });
  await prisma.visit.create({
    data: {
      patientId: amina.id,
      vitals: { weight: "62", temperature: "38.4", bloodPressure: "118/76" },
      priority: "urgent",
      complaint: "",
      assignedDoctorId: doc1,
      status: "waiting",
    },
  });

  const john = await prisma.patient.create({
    data: {
      mrn: "P-0002",
      nationalId: "11203344",
      firstName: "John",
      lastName: "Mwangi",
      gender: "male",
      age: 45,
      phone: "0722 333444",
    },
  });
  await prisma.visit.create({
    data: {
      patientId: john.id,
      vitals: { weight: "", temperature: "", bloodPressure: "" },
      complaint: "",
      assignedDoctorId: doc2,
      status: "awaiting-triage",
    },
  });
  console.log("Seeded 2 demo patients.");
}

async function main() {
  // Targeted seeds for a live clinic, where the demo staff and demo patients
  // below are not wanted. Both flags may be passed together.
  const onlyCatalog = process.argv.includes("--catalog-only");
  const onlyMedicines = process.argv.includes("--medicines-only");
  if (onlyCatalog || onlyMedicines) {
    if (onlyCatalog) await ensureServiceCatalog();
    if (onlyMedicines) await ensureMedicines();
    return;
  }

  await ensureStaff();
  await ensureMedicines();
  await ensureServiceCatalog();

  if (process.argv.includes("--reset-demo")) {
    await prisma.order.deleteMany();
    await prisma.visit.deleteMany();
    await prisma.patient.deleteMany();
    console.log("Cleared existing patients/visits/orders.");
  }

  if ((await prisma.patient.count()) === 0) {
    await seedDemoPatients();
  } else {
    console.log("Patients already present — skipping demo seed.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
