/**
 * Weber State reference data: colleges, departments, majors and campus
 * buildings. Names follow WSU's academic structure closely enough for user
 * testing; admins maintain the real lists in Admin → Directory.
 */

export type CollegeKey = "gsbe" | "east" | "cos" | "sbs" | "edu" | "health" | "arts";

export type DeptDef = { name: string; majors: string[] };
export type CollegeDef = { key: CollegeKey; name: string; shortName: string; slug: string; studentWeight: number; departments: DeptDef[] };

export const COLLEGES: CollegeDef[] = [
  {
    key: "gsbe",
    name: "John B. Goddard School of Business & Economics",
    shortName: "Goddard School",
    slug: "goddard-school-of-business-economics",
    studentWeight: 19,
    departments: [
      { name: "School of Accounting & Taxation", majors: ["Accounting"] },
      { name: "Business Administration", majors: ["Business Administration", "Marketing", "Management", "Supply Chain Management", "Professional Sales", "Human Resource Management"] },
      { name: "Economics", majors: ["Economics"] },
      { name: "Finance", majors: ["Finance"] },
      { name: "Information Systems & Technologies", majors: ["Information Systems & Technologies", "Business Analytics"] },
    ],
  },
  {
    key: "east",
    name: "College of Engineering, Applied Science & Technology",
    shortName: "EAST",
    slug: "engineering-applied-science-technology",
    studentWeight: 19,
    departments: [
      { name: "School of Computing", majors: ["Computer Science", "Cybersecurity", "Web & User Experience", "Network Management Technology"] },
      { name: "Electrical & Computer Engineering", majors: ["Electrical Engineering", "Computer Engineering"] },
      { name: "Mechanical Engineering", majors: ["Mechanical Engineering"] },
      { name: "Engineering Technology", majors: ["Electronics Engineering Technology", "Mechanical Engineering Technology"] },
      { name: "Manufacturing & Systems Engineering", majors: ["Manufacturing Engineering", "Product Design"] },
      { name: "Automotive Technology", majors: ["Automotive Technology"] },
      { name: "Construction Management", majors: ["Construction Management"] },
      { name: "Design Graphics Engineering Technology", majors: ["Design Engineering Technology"] },
    ],
  },
  {
    key: "cos",
    name: "College of Science",
    shortName: "Science",
    slug: "college-of-science",
    studentWeight: 13,
    departments: [
      { name: "Botany", majors: ["Botany"] },
      { name: "Chemistry & Biochemistry", majors: ["Chemistry", "Biochemistry"] },
      { name: "Earth & Environmental Sciences", majors: ["Geology", "Environmental Science"] },
      { name: "Mathematics", majors: ["Mathematics", "Applied Mathematics", "Data Science"] },
      { name: "Microbiology", majors: ["Microbiology"] },
      { name: "Physics & Astronomy", majors: ["Physics"] },
      { name: "Zoology", majors: ["Zoology"] },
    ],
  },
  {
    key: "sbs",
    name: "College of Social & Behavioral Sciences",
    shortName: "Social & Behavioral Sciences",
    slug: "social-behavioral-sciences",
    studentWeight: 15,
    departments: [
      { name: "Anthropology", majors: ["Anthropology"] },
      { name: "Criminal Justice", majors: ["Criminal Justice"] },
      { name: "Geography", majors: ["Geography"] },
      { name: "History", majors: ["History"] },
      { name: "Political Science & Philosophy", majors: ["Political Science", "Philosophy"] },
      { name: "Psychology", majors: ["Psychology", "Neuroscience"] },
      { name: "Social Work & Gerontology", majors: ["Social Work", "Gerontology"] },
      { name: "Sociology", majors: ["Sociology"] },
      { name: "Military Science", majors: [] },
    ],
  },
  {
    key: "edu",
    name: "Jerry & Vickie Moyes College of Education",
    shortName: "Moyes College of Education",
    slug: "moyes-college-of-education",
    studentWeight: 8,
    departments: [
      { name: "Teacher Education", majors: ["Elementary Education", "Special Education", "Early Childhood Education"] },
      { name: "Child & Family Studies", majors: ["Family Studies"] },
      { name: "Kinesiology", majors: ["Exercise Science", "Physical Education", "Human Performance Management"] },
      { name: "Health Promotion", majors: ["Public Health", "Outdoor Recreation"] },
    ],
  },
  {
    key: "health",
    name: "Dr. Ezekiel R. Dumke College of Health Professions",
    shortName: "Dumke College of Health Professions",
    slug: "dumke-college-of-health-professions",
    studentWeight: 17,
    departments: [
      { name: "Annie Taylor Dee School of Nursing", majors: ["Nursing"] },
      { name: "Dental Hygiene", majors: ["Dental Hygiene"] },
      { name: "Emergency Care & Rescue", majors: ["Paramedic"] },
      { name: "Health Administrative Services", majors: ["Health Administration", "Health Information Management", "Health Sciences"] },
      { name: "Medical Laboratory Sciences", majors: ["Medical Laboratory Science"] },
      { name: "Radiologic Sciences", majors: ["Radiologic Sciences"] },
      { name: "Respiratory Therapy", majors: ["Respiratory Therapy"] },
    ],
  },
  {
    key: "arts",
    name: "Telitha E. Lindquist College of Arts & Humanities",
    shortName: "Lindquist College of Arts & Humanities",
    slug: "lindquist-college-of-arts-humanities",
    studentWeight: 9,
    departments: [
      { name: "Communication", majors: ["Communication"] },
      { name: "English Language & Literature", majors: ["English", "Creative Writing"] },
      { name: "Foreign Languages", majors: ["Spanish", "French", "Japanese"] },
      { name: "Performing Arts", majors: ["Theatre Arts", "Dance"] },
      { name: "Music", majors: ["Music", "Music Education"] },
      { name: "Visual Art & Design", majors: ["Art", "Graphic Design", "Photography"] },
    ],
  },
];

/** Interdisciplinary programs that sit outside a single college. */
export const UNAFFILIATED_MAJORS = ["Integrated Studies", "General Studies"];

export type BuildingDef = { code: string; name: string; campus: "Ogden" | "Davis"; lat: number; lng: number; rooms: string[] };

const OGDEN = "3848 Harrison Blvd, Ogden, UT 84408";
const DAVIS = "2750 University Park Blvd, Layton, UT 84041";
export const CAMPUS_ADDRESS = { Ogden: OGDEN, Davis: DAVIS } as const;

/**
 * Campus buildings. Coordinates are APPROXIMATE (good enough to drop a map pin
 * on the right part of campus) — confirm against WSU facilities data before launch.
 */
export const BUILDINGS: BuildingDef[] = [
  { code: "SU", name: "Shepherd Union", campus: "Ogden", lat: 41.1922, lng: -111.9437, rooms: ["Room 316", "Room 321", "Room 404A", "Room 404B", "Wildcat Theater", "Ballroom C"] },
  { code: "LI", name: "Stewart Library", campus: "Ogden", lat: 41.1911, lng: -111.9447, rooms: ["Room 145", "Room 307", "Room 321"] },
  { code: "TY", name: "Tracy Hall Science Center", campus: "Ogden", lat: 41.1897, lng: -111.9424, rooms: ["Room 150", "Room 225", "Room 316", "Room 336"] },
  { code: "WB", name: "Wattis Business Building", campus: "Ogden", lat: 41.1933, lng: -111.9456, rooms: ["Room 108", "Room 205", "Room 210", "Room 218"] },
  { code: "LL", name: "Lind Lecture Hall", campus: "Ogden", lat: 41.1926, lng: -111.9449, rooms: ["Room 101", "Room 112", "Room 216", "Ott Planetarium"] },
  { code: "EH", name: "Elizabeth Hall", campus: "Ogden", lat: 41.1917, lng: -111.9462, rooms: ["Room 229", "Room 304", "Room 412"] },
  { code: "BC", name: "Val A. Browning Center", campus: "Ogden", lat: 41.1937, lng: -111.9428, rooms: ["Room 223", "Allred Theater lobby", "Eccles Theater rehearsal hall"] },
  { code: "KA", name: "Kimball Visual Arts Center", campus: "Ogden", lat: 41.1942, lng: -111.9434, rooms: ["Room 120", "Ceramics Studio 160", "Shaw Gallery"] },
  { code: "MH", name: "Marriott Allied Health Building", campus: "Ogden", lat: 41.1885, lng: -111.9447, rooms: ["Room 101", "Room 214", "Room 322"] },
  { code: "ED", name: "McKay Education Building", campus: "Ogden", lat: 41.1903, lng: -111.9468, rooms: ["Room 210", "Room 302", "Room 319"] },
  { code: "NB", name: "Noorda Engineering, Applied Science & Technology Building", campus: "Ogden", lat: 41.188, lng: -111.9418, rooms: ["Room 150 (Makerspace)", "Room 210", "Room 220", "Room 308"] },
  { code: "SS", name: "Social Science Building", campus: "Ogden", lat: 41.1909, lng: -111.9458, rooms: ["Room 130", "Room 238", "Room 341"] },
  { code: "LH", name: "Lindquist Hall", campus: "Ogden", lat: 41.1929, lng: -111.9466, rooms: ["Room 216", "Room 362", "Room 102"] },
  { code: "SG", name: "Swenson Gym", campus: "Ogden", lat: 41.195, lng: -111.9418, rooms: ["Main Gym", "Room 202"] },
  { code: "SC", name: "Stromberg Complex", campus: "Ogden", lat: 41.1956, lng: -111.9443, rooms: ["Climbing Wall", "Court 3", "Room 110"] },
  { code: "DC", name: "Dee Events Center", campus: "Ogden", lat: 41.1844, lng: -111.9361, rooms: ["Concourse", "Hall of Fame Room"] },
  { code: "ST", name: "Stewart Stadium", campus: "Ogden", lat: 41.1829, lng: -111.9389, rooms: ["Practice Field", "Stadium Club Room"] },
  { code: "SSC", name: "Student Services Center", campus: "Ogden", lat: 41.1914, lng: -111.9431, rooms: ["Room 140", "Room 260"] },
  { code: "MA", name: "Miller Administration Building", campus: "Ogden", lat: 41.1906, lng: -111.9437, rooms: ["Room 101", "Room 222"] },
  { code: "HC", name: "Hurst Center for Lifelong Learning", campus: "Ogden", lat: 41.1898, lng: -111.9402, rooms: ["Room 112", "Room 200"] },
  { code: "D2", name: "Davis Campus Building D2", campus: "Davis", lat: 41.0815, lng: -111.9744, rooms: ["Room 110", "Room 230"] },
  { code: "D3", name: "Computer & Automotive Engineering Building (D3)", campus: "Davis", lat: 41.0821, lng: -111.9735, rooms: ["Room 106", "Room 204"] },
];

/** Where each college's clubs usually meet. */
export const COLLEGE_BUILDINGS: Record<CollegeKey | "university" | "sports", string[]> = {
  gsbe: ["WB", "WB", "LI"],
  east: ["NB", "NB", "D3"],
  cos: ["TY", "TY", "LL"],
  sbs: ["SS", "LH", "SS"],
  edu: ["ED", "ED"],
  health: ["MH", "MH"],
  arts: ["EH", "BC", "KA"],
  university: ["SU", "SU", "LI", "SSC"],
  sports: ["SC", "SG", "SU"],
};

/** Off-campus spots (approximate coordinates) for socials, service days and trips. */
type Spot = { address: string; lat: number; lng: number };
export const OFFSITE: Record<"service" | "social" | "outdoors", Spot[]> = {
  service: [
    { address: "Ogden Nature Center, 966 W 12th St, Ogden, UT 84404", lat: 41.2347, lng: -111.9934 },
    { address: "Weber County Library — Main Branch, 2464 Jefferson Ave, Ogden, UT 84401", lat: 41.2213, lng: -111.9688 },
    { address: "Lorin Farr Park, 1691 Canfield Dr, Ogden, UT 84404", lat: 41.2365, lng: -111.9611 },
    { address: "Ogden River Parkway trailhead at 21st St Pond, Ogden, UT", lat: 41.2297, lng: -111.9946 },
  ],
  social: [
    { address: "Historic 25th Street, Ogden, UT 84401", lat: 41.2207, lng: -111.9737 },
    { address: "Ogden Union Station, 2501 Wall Ave, Ogden, UT 84401", lat: 41.2208, lng: -111.9814 },
    { address: "Ogden Amphitheater, 343 25th St, Ogden, UT 84401", lat: 41.2213, lng: -111.9707 },
  ],
  outdoors: [
    { address: "Snowbasin Resort, 3925 Snowbasin Rd, Huntsville, UT 84317", lat: 41.2161, lng: -111.8569 },
    { address: "Powder Mountain, 6965 E Powder Mountain Rd, Eden, UT 84310", lat: 41.3792, lng: -111.7807 },
    { address: "Waterfall Canyon trailhead, 29th St & Buchanan Ave, Ogden, UT", lat: 41.2005, lng: -111.9327 },
    { address: "Ogden Canyon, Pineview Reservoir north beach, Huntsville, UT", lat: 41.2617, lng: -111.8139 },
  ],
};

/**
 * Where generated people live, for member details: Weber and Davis county
 * towns with their ZIP codes and the kind of street a house there is on.
 * Street numbers are generated, so no address is a real one.
 */
export type HomeTown = { city: string; zips: string[]; weight: number; streets: string[] };
export const HOME_TOWNS: HomeTown[] = [
  { city: "Ogden", zips: ["84401", "84403", "84404", "84405"], weight: 30, streets: ["Harrison Blvd", "Washington Blvd", "Monroe Blvd", "Jefferson Ave", "Adams Ave", "Quincy Ave", "Tyler Ave", "Polk Ave", "Gramercy Ave", "Liberty Ave", "Fowler Ave", "Taylor Ave"] },
  { city: "South Ogden", zips: ["84403", "84405"], weight: 7, streets: ["Chimes View Dr", "Ben Lomond Ave", "Edgewood Dr", "Glasmann Way"] },
  { city: "North Ogden", zips: ["84414"], weight: 5, streets: ["Fruitland Dr", "Mountain Rd", "Elberta Dr"] },
  { city: "Riverdale", zips: ["84405"], weight: 3, streets: ["Parker Dr", "Ritter Dr", "River Park Dr"] },
  { city: "Roy", zips: ["84067"], weight: 7, streets: ["Midland Dr", "Hinckley Dr", "Sandridge Dr"] },
  { city: "Layton", zips: ["84040", "84041"], weight: 10, streets: ["Gentile St", "Hill Field Rd", "Fort Lane", "Antelope Dr", "Church St"] },
  { city: "Kaysville", zips: ["84037"], weight: 5, streets: ["Flint St", "Mutton Hollow Rd", "Crestwood Rd"] },
  { city: "Clearfield", zips: ["84015"], weight: 5, streets: ["State St", "Center St", "Antelope Dr"] },
  { city: "Syracuse", zips: ["84075"], weight: 4, streets: ["Bluff Rd", "Gentile St", "Allison Way"] },
  { city: "Clinton", zips: ["84015"], weight: 3, streets: ["Clinton Pkwy", "Center St"] },
  { city: "West Haven", zips: ["84401"], weight: 3, streets: ["Midland Dr", "Wilson Ln"] },
  { city: "Pleasant View", zips: ["84404", "84414"], weight: 2, streets: ["Pleasant View Dr", "Elberta Dr"] },
  { city: "Harrisville", zips: ["84404"], weight: 2, streets: ["Larsen Ln", "Harrisville Rd"] },
  { city: "Farmington", zips: ["84025"], weight: 3, streets: ["Main St", "Glovers Ln", "Shepard Ln"] },
  { city: "Bountiful", zips: ["84010"], weight: 3, streets: ["Orchard Dr", "Main St", "Davis Blvd"] },
  { city: "Brigham City", zips: ["84302"], weight: 2, streets: ["Main St", "Forest St"] },
  { city: "Huntsville", zips: ["84317"], weight: 1, streets: ["Ogden Canyon Rd"] },
];
/** Utah's grid: "1234 W 4000 S" style addresses for the towns above. */
export const GRID_DIRECTIONS = ["N", "S", "E", "W"] as const;
