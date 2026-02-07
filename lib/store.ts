// Stockage en mémoire (V1). Pour V2 on passera à une DB/KV.
let memory: any = null;

export function getWeekly() {
  return memory;
}

export function setWeekly(data: any) {
  memory = data;
}
