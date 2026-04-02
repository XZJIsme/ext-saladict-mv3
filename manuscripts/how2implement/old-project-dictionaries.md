# 旧项目查词词典清单

这份清单整理的是 `old-salad-archive` 里真正接入到查词系统的词典 source。

判定依据：
- 注册入口：`old-salad-archive/src/app-config/dicts.ts`
- 默认/情景模式选择：`old-salad-archive/src/app-config/profiles.ts`
- 各词典自身目录：`old-salad-archive/src/components/dictionaries/*`

## 总览

旧项目当前真正注册进查词系统的 source 一共 **35 个**。

另外还有一个目录存在但默认没有注册进系统的 source：
- `shanbay`

## 1. 机器翻译类

这类更偏“整句翻译”或“快速翻译”。

- `google`：谷歌翻译
- `youdaotrans`：有道翻译
- `baidu`：百度翻译
- `tencent`：腾讯翻译君
- `caiyun`：彩云小译
- `sogou`：搜狗翻译

## 2. 英语词典 / 英英英汉类

这类更偏单词、短语、释义、例句、词形变化等。

- `bing`：必应词典 / 必应翻译结果页词典区
- `cobuild`：柯林斯
- `cambridge`：剑桥词典
- `longman`：朗文
- `macmillan`：麦克米伦
- `lexico`：Lexico
- `oaldict`：牛津词典
- `merriamwebster`：Merriam-Webster
- `websterlearner`：韦氏学习词典
- `vocabulary`：Vocabulary.com
- `ahdict`：美国传统词典
- `googledict`：Google Dictionary
- `youdao`：有道词典
- `eudic`：欧路词典
- `urban`：Urban Dictionary
- `etymonline`：Etymonline

## 3. 句库 / 例句 / 学术检索类

这类更适合整句、搭配、双语例句或学术语境。

- `jukuu`：句酷
- `cnki`：CNKI 翻译助手
- `renren`：人人词典

## 4. 汉语相关

这类更偏中文词语、汉字、国语辞典和两岸词典。

- `zdic`：汉典
- `guoyu`：国语辞典
- `liangan`：两岸词典

## 5. 日语 / 韩语 / 百科 / 流行词

这类不完全是传统英汉词典，但旧项目也作为查词 source 接入。

- `mojidict`：MOJi 辞书
- `hjdict`：沪江小D
- `weblio`：Weblio 国语辞典等
- `weblioejje`：Weblio 英和・和英
- `naver`：Naver 词典
- `wikipedia`：维基百科
- `jikipedia`：小鸡词典

## 默认 Profile 里默认选中的词典

旧项目默认 profile 不是把 35 个全部展开，而是先选了下面这些：

- `bing`
- `cobuild`
- `cambridge`
- `youdao`
- `urban`
- `vocabulary`
- `caiyun`
- `youdaotrans`
- `zdic`
- `guoyu`
- `liangan`
- `googledict`

这说明旧项目默认体验更偏这几类：
- 常用英英/英汉词典
- 机器翻译
- 中文词典

## 情景模式里能看出的分组倾向

从 `profiles.ts` 可以看出作者对不同场景的理解：

- `sentence`：偏句子和例句
  - `jukuu`、`bing`、`cnki`、`renren`、`eudic`、`cobuild`、`cambridge`、`longman`、`macmillan`
- `translation`：偏整句机器翻译
  - `google`、`tencent`、`baidu`、`caiyun`、`youdaotrans`
- `scholar`：偏学术与较正式英语词典
  - `googledict`、`cambridge`、`cobuild`、`etymonline`、`cnki`、`macmillan`、`lexico`、`websterlearner`、`google`、`youdaotrans`
- `nihongo`：偏日语场景
  - `mojidict`、`hjdict`、`weblioejje`、`weblio`、`google`、`tencent`、`caiyun`、`googledict`、`wikipedia`

## 对当前新插件的参考价值

如果后面要从旧项目里挑词典迁移，建议优先分三层看：

第一层，最值得优先迁移：
- `google`
- `baidu`
- `caiyun`
- `youdao`
- `cobuild`
- `cambridge`
- `zdic`

第二层，适合做“句子 / 例句”增强：
- `bing`
- `jukuu`
- `cnki`
- `renren`
- `eudic`

第三层，适合后续做多语言扩展：
- `mojidict`
- `hjdict`
- `weblio`
- `weblioejje`
- `naver`
- `wikipedia`

## 备注

- `shanbay` 目录虽然还在，但在 `dicts.ts` 里被注释掉了，所以不算当前正式接入的词典。
- 旧项目里“词典 source”和“机器翻译 source”共用同一套查词面板体系，所以这里一并记入。
