export const releasePlatforms=[
  {id:'win',host:'win32',arch:'x64',formats:['exe'],targets:['nsis'],en:'Windows 10 / 11 · x64',zh:'Windows 10 / 11 · 64 位'},
  {id:'mac',host:'darwin',arch:'universal',formats:['dmg'],targets:['dmg'],en:'macOS 13+ · Apple Silicon + Intel',zh:'macOS 13+ · Apple 芯片与 Intel'},
];
export const releaseLanguages=['en','zh-CN'];
export function installerAssets(version){
  return releasePlatforms.flatMap(platform=>releaseLanguages.flatMap(language=>platform.formats.map(format=>({
    name:`Lettide-${version}-${platform.id}-${platform.arch}-${language}.${format}`,
    platform:platform.id,language,format,label:`${platform.en} · ${language==='en'?'English / 英文':'简体中文 / Chinese'} · ${format}`,
  }))));
}
export function downloadTable(version,language='en'){
  const chinese=language==='zh-CN',base=`https://github.com/shixi-11/lettide/releases/download/v${version}/`;
  const rows=[chinese?'| 系统与安装包 | 简体中文「叠信」 | English “Lettide” |':'| Platform and package | English “Lettide” | 简体中文「叠信」 |','| --- | --- | --- |'];
  for(const platform of releasePlatforms)for(const format of platform.formats){
    const links=(chinese?['zh-CN','en']:['en','zh-CN']).map(lang=>`[${lang==='zh-CN'?'下载':'Download'} ${format}](${base}Lettide-${version}-${platform.id}-${platform.arch}-${lang}.${format})`);
    rows.push(`| ${platform[chinese?'zh':'en']} | ${links.join(' | ')} |`);
  }return rows.join('\n');
}
