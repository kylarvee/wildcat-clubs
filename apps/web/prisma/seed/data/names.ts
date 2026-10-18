/**
 * Name banks for generated people — a mix that looks like Northern Utah:
 * longtime Utah families, a large Latino community, Pacific Islander,
 * Asian, African, Middle Eastern and Native American students.
 * Persona surnames are left out so personas stay easy to spot.
 *
 * First names are grouped so a generated person's name, pronouns and the
 * gender on their member details agree with each other.
 */

export const FEMALE_FIRST = [
  // common in Utah
  "Emma", "Olivia", "Ava", "Sophia", "Mia", "Abigail", "Emily", "Madison", "Hannah", "Ashley", "Brooklyn", "Kaylee", "McKenna", "Brynn",
  "Addison", "Lauren", "Rachel", "Megan", "Natalie", "Savannah", "Chloe", "Grace", "Lily", "Aubrey", "Ellie", "Paige", "Sierra", "Alyssa",
  "Hailey", "Kylie", "Whitney", "Shelby", "Tess", "Nora", "Elise", "Clara", "Ivy", "Ruby", "Hazel", "Stella", "Leah", "Sarah", "Rebecca",
  "Katelyn", "Amber", "Brianna", "Eliza", "Annie", "Josie", "Lydia", "Maren", "Kate", "Claire", "Allie", "Jenna", "Kira", "Sadie",
  // Latino
  "Camila", "Valeria", "Ximena", "Daniela", "Gabriela", "Mariana", "Lucia", "Andrea", "Fernanda", "Sofia", "Ana", "Yesenia", "Guadalupe",
  "Itzel", "Marisol", "Paola", "Karla", "Jimena", "Alondra", "Esmeralda",
  // Pacific Islander
  "Leilani", "Malia", "Mele", "Losana", "Sina", "Talia", "Ofa", "Lupe",
  // Asian
  "Keiko", "Yuna", "Mei", "Linh", "Thao", "Anh", "Hana", "Ji-woo", "Seo-yeon", "Ananya", "Priyanka", "Neha", "Mai", "Yui",
  // African, Middle Eastern, other
  "Aisha", "Fatima", "Zainab", "Amara", "Nia", "Imani", "Kiara", "Layla", "Noor", "Ngozi", "Selam", "Mariam", "Yasmin",
  // Native American (Diné and others common in Utah)
  "Shandiin", "Nizhoni", "Dezba", "Winona",
] as const;

export const MALE_FIRST = [
  // common in Utah
  "Liam", "Noah", "Ethan", "Mason", "Logan", "Lucas", "Jackson", "Carter", "Tanner", "Bridger", "Ty", "Cole", "Braden", "Jaxon", "Kade",
  "Easton", "Hunter", "Spencer", "Tyler", "Jacob", "Joshua", "Caleb", "Isaac", "Samuel", "Benjamin", "Dallin", "Jared", "Porter", "Colton",
  "Garrett", "Derek", "Trevor", "Owen", "Wyatt", "Gavin", "Brody", "Austin", "Kyle", "Dylan", "Ryan", "Zachary", "Aaron", "Adam", "Jonah",
  "Henry", "Oliver", "Elias", "Tobias", "Landon", "Brigham", "Talmage", "McKay", "Nathaniel", "Gabe", "Trent", "Seth", "Connor", "Bryce",
  // Latino
  "Mateo", "Diego", "Santiago", "Alejandro", "Javier", "Luis", "Carlos", "Miguel", "Jose", "Angel", "Eduardo", "Ricardo", "Emilio",
  "Andres", "Joaquin", "Jesus", "Rafael", "Marco", "Julian", "Adrian",
  // Pacific Islander
  "Sione", "Tevita", "Viliami", "Siosaia", "Semisi", "Kaleo", "Malakai", "Keanu", "Lopeti", "Penisimani",
  // Asian
  "Hiroshi", "Kenji", "Minh", "Tuan", "Duc", "Wei", "Jun", "Arjun", "Rohan", "Vikram", "Bao", "Hyun", "Raj",
  // African, Middle Eastern, other
  "Omar", "Yusuf", "Hassan", "Ahmed", "Kwame", "Malik", "Darius", "Jamal", "Andre", "Marcus", "Tariq", "Chidi", "Abebe", "Kofi", "Samir",
  // Native American
  "Ahiga", "Tahoma", "Hosteen",
] as const;

/** Names used by people of any gender. */
export const NEUTRAL_FIRST = ["Taylor", "Jordyn", "Bailey", "Kenzie", "Kai", "Rowan", "Avery", "Quinn", "Riley", "Sage", "Jamie", "Alex", "Remy", "Ari", "Skyler", "Emerson"] as const;

export const FIRST_NAMES = [...FEMALE_FIRST, ...MALE_FIRST, ...NEUTRAL_FIRST] as const;

export const LAST_NAMES = [
  "Smith", "Johnson", "Anderson", "Jensen", "Christensen", "Larsen", "Nielsen", "Petersen", "Hansen", "Olsen", "Thompson", "Young",
  "Allen", "Taylor", "Clark", "Hall", "Wright", "Hill", "Green", "Baker", "Nelson", "Carter", "Mitchell", "Roberts", "Phillips",
  "Evans", "Turner", "Parker", "Collins", "Edwards", "Stewart", "Morris", "Murphy", "Cook", "Rogers", "Peterson", "Cooper", "Bailey",
  "Bell", "Howard", "Ward", "Cox", "Richardson", "Wood", "Watson", "Bennett", "Gray", "James", "Hughes", "Price", "Sanders", "Myers",
  "Long", "Ross", "Foster", "Powell", "Jenkins", "Perry", "Russell", "Sullivan", "Fisher", "Henderson", "Coleman", "Simmons",
  "Patterson", "Jordan", "Reynolds", "Hamilton", "Graham", "Wallace", "West", "Cole", "Hayes", "Bryant", "Gibson", "Ellis",
  "Stevens", "Murray", "Ford", "Marshall", "Owens", "McDonald", "Harrison", "Kennedy", "Wells", "Hunt", "Black", "Holt", "Barlow",
  "Monson", "Eccles", "Hatch", "Thatcher", "Bingham", "Cannon", "Pratt", "Kimball", "Child", "Tolman", "Stoddard", "Wardle",
  "Garcia", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Rodriguez", "Perez", "Sanchez", "Ramirez", "Flores", "Gomez", "Diaz",
  "Reyes", "Morales", "Cruz", "Ortiz", "Gutierrez", "Chavez", "Ramos", "Ruiz", "Alvarado", "Mendoza", "Castillo", "Jimenez",
  "Vargas", "Romero", "Herrera", "Medina", "Aguilar", "Vasquez", "Silva", "Navarro", "Salazar", "Cortez",
  "Fifita", "Tuilagi", "Taufa", "Vainuku", "Havili", "Mahe", "Kauvaka", "Latu", "Moala", "Pulu", "Fonua", "Faleolo", "Sopoaga",
  "Tran", "Le", "Pham", "Huynh", "Kim", "Lee", "Wang", "Liu", "Zhang", "Yamamoto", "Tanaka", "Sato", "Nakamura", "Choi",
  "Shah", "Singh", "Gupta", "Kumar", "Reddy", "Iyer",
  "Ali", "Khan", "Hussein", "Abdi", "Mohamed", "Osei", "Mensah", "Adeyemi", "Okonkwo", "Bekele", "Tesfaye",
  "Begay", "Yazzie", "Tsosie", "Benally", "Nez",
  "Johansson", "Novak", "Kowalski", "Rossi", "Schmidt", "Weber", "Dubois",
  "Sorensen", "Jacobsen", "Madsen", "Lund", "Rasmussen", "Poulsen", "Bowen", "Day", "Udall", "Snow", "Lyman", "Woolley", "Call",
  "Ashby", "Grover", "Peck", "Nash", "Hale", "Burton", "Webb", "Crane", "Frost", "Riggs", "Dalton", "Mercer",
  "Espinoza", "Fuentes", "Rios", "Sandoval", "Delgado", "Soto", "Valdez", "Guerrero", "Luna", "Campos", "Ibarra", "Montes",
  "Tupou", "Mateaki", "Kioa", "Lolohea", "Vo", "Dang", "Jung", "Ito", "Kobayashi", "Huang", "Lin", "Zhou",
  "Nair", "Menon", "Bhatt", "Rahimi", "Nasser", "Omondi", "Kariuki", "Diallo", "Toure", "Yohannes", "Girma",
  "Etsitty", "Joe", "Tso", "Chee",
] as const;

export const PRONOUNS = ["she/her", "he/him", "they/them", "she/they", "he/they"] as const;

/** Pronouns that fit a gender (null gender: anything). */
export const PRONOUNS_FOR = {
  FEMALE: ["she/her", "she/her", "she/her", "she/her", "she/they"],
  MALE: ["he/him", "he/him", "he/him", "he/him", "he/they"],
  NON_BINARY: ["they/them", "they/them", "she/they", "he/they"],
  PREFER_NOT_TO_SAY: ["they/them"],
} as const;
